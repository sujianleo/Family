import { automationActions, automationUnits, type AutomationActionId } from "../automationRegistry";
import {
  type AppAnswerQueryType,
  type AssistantRouteContext,
  type AssistantRoute,
  type AssistantRouteContract,
  buildAssistantClarification,
  describeAssistantRouteContract,
  isConversationContextQuestion,
  isFamilyKnowledgeRecallQuestion,
  isShortContextContinuation,
  isUnconfirmedPersonalFactStatement,
  routeAssistantInput
} from "../assistantRouter";
import { detectDangerousOperation } from "../safetyGuard";
import { isAmbiguousOrganizationRequest, isExplicitTaskCommand, isTimedTaskStatement } from "../taskIntent";
import type { FamilyMember } from "../types";
import { invokeRouteChain, invokeRouteReflectionChain } from "./ai/chains/route.chain";
import { createFastModel } from "./ai/models";
import { getFastModelName } from "./langchainAi";
import { listFamilyAutomationToolNames } from "./langchainTools";
import { hashFamilyContext, readCachedAssistantRoute, writeCachedAssistantRoute } from "./assistantRouteCache";
import {
  appendAssistantRouteShadowRecord,
  classifyRouteDisagreement
} from "./assistantRouteShadow";

const routeIntentPromptVersion = "route-intent-v3";
const summaryActionIds = new Set<AutomationActionId>([
  "summary.personal.daily",
  "summary.personal.weekly",
  "summary.family.daily",
  "summary.family.weekly",
  "summary.family.monthly"
]);

export type AssistantRouteReflectionReason =
  | "context_uncertainty"
  | "low_confidence"
  | "multiple_candidates"
  | "route_disagreement"
  | "write_risk";

export async function routeAssistantWithLangChain(
  text: string,
  members: FamilyMember[],
  context: AssistantRouteContext = {}
): Promise<AssistantRoute> {
  const normalized = text.trim();
  if (!normalized) {
    return {
      kind: "fallback",
      reason: "assignment_or_search"
    };
  }

  const dangerousOperation = detectDangerousOperation(normalized);
  if (dangerousOperation) {
    return {
      kind: "action",
      id: "safety.dangerous_operation",
      parameters: {
        text: normalized
      }
    };
  }

  const localRoute = routeAssistantInput(normalized, members, context);
  // A locally parsed date/time task is deterministic. Return the confirmation
  // candidate before constructing or invoking the model router.
  if (isTimedTaskStatement(normalized)) {
    return localRoute;
  }
  if (localRoute.kind === "action" && localRoute.id === "group.organize.contextual") {
    return localRoute;
  }
  const localContract = describeAssistantRouteContract(normalized, members, context);
  const hasDialogueContext = Boolean(context.recentConversation?.length || context.recentUserTexts?.length);
  const shouldShadow =
    localRoute.kind === "fallback" ||
    localContract.confidence < 0.9 ||
    requiresSemanticModelResolution(normalized) ||
    (hasDialogueContext && requiresContextResolution(normalized));
  if (!shouldShadow) {
    return localRoute;
  }

  const routerTimeoutMs = boundedTimeout(
    Number(process.env.DEEPSEEK_ROUTER_TIMEOUT_MS || process.env.DEEPSEEK_TIMEOUT_MS || 5000),
    6500
  );
  const reflectionTimeoutMs = boundedTimeout(
    Number(process.env.DEEPSEEK_ROUTER_REFLECTION_TIMEOUT_MS || 2500),
    3000
  );
  const model = createFastModel({
    maxTokens: 360,
    temperature: 0.1,
    timeoutMs: routerTimeoutMs
  });
  if (!model) {
    return semanticFallbackRoute(normalized, localRoute);
  }

  const startedAt = Date.now();
  const modelName = getFastModelName();
  try {
    const familyContext = members.map((member) => ({
      displayName: member.displayName,
      id: member.id,
      relationshipRole: member.relationshipRole
    }));
    const recentContext = context.recentConversation?.length
      ? context.recentConversation.slice(-12).map((turn) => `${turn.role}: ${turn.text}`).join("\n")
      : (context.recentUserTexts || []).slice(-8).join("\n");
    const familyContextHash = hashFamilyContext({
      actorMemberId: context.actorMemberId || "",
      actorName: context.actorName || "",
      dialogueState: context.dialogueState || null,
      familyContext,
      recentContext
    });
    const cachedRoute = await readCachedAssistantRoute({
      familyContextHash,
      inputText: normalized,
      modelName,
      promptVersion: routeIntentPromptVersion
    });
    const routerInput = {
      actor: {
        displayName: context.actorName || "当前成员",
        memberId: context.actorMemberId || ""
      },
      candidateActions: automationActionsForPrompt(),
      currentDate: new Date().toISOString().slice(0, 10),
      familyMembers: members,
      recentContext: context.recentConversation?.length
        ? context.recentConversation.slice(-12).map((turn) => `${turn.role}: ${turn.text}`)
        : (context.recentUserTexts || []).slice(-8),
      userInput: normalized
    };
    const chainContext = {
      availableUnits: automationUnits.map((unit) => ({
        id: unit.id,
        label: unit.label,
        unit: unit.unit
      })),
      deterministicHint: describeRoute(localRoute),
      toolNames: listFamilyAutomationToolNames()
    };
    const initialValidation = cachedRoute
      ? { ok: true as const, route: cachedRoute }
      : await invokeRouteChain(
          routerInput,
          chainContext,
          {
            maxTokens: 360,
            timeoutMs: routerTimeoutMs
          }
        );
    if (!initialValidation.ok && initialValidation.reason !== "low_confidence") throw new Error(initialValidation.reason);

    const initialModelContract = initialValidation.route;
    const initialModelRoute = modelContractToAssistantRoute(initialModelContract, normalized);
    const reflectionReason = cachedRoute
      ? null
      : assistantRouteReflectionReason({
          context,
          localRoute,
          modelContract: initialModelContract,
          modelRoute: initialModelRoute,
          text: normalized,
          validationReason: initialValidation.ok ? null : initialValidation.reason
        });
    let reflectedModelContract: AssistantRouteContract | null = null;
    let finalValidation = initialValidation;
    if (reflectionReason) {
      finalValidation = await invokeRouteReflectionChain(
        routerInput,
        {
          ...chainContext,
          concern: reflectionReason,
          initialCandidate: initialModelContract
        },
        {
          maxTokens: 220,
          timeoutMs: reflectionTimeoutMs
        }
      );
      reflectedModelContract = finalValidation.route;
    }

    const reflectionFailed = Boolean(reflectionReason && !finalValidation.ok);
    const finalModelContract = finalValidation.route;
    let modelRoute = reflectionFailed
      ? clarificationFallback(normalized)
      : modelContractToAssistantRoute(finalModelContract, normalized);
    if (isUnsafeWritePromotion(localRoute, modelRoute, normalized)) {
      modelRoute = clarificationFallback(normalized);
    }

    if (!cachedRoute && finalValidation.ok) {
      await writeCachedAssistantRoute({
        familyContextHash,
        inputText: normalized,
        modelName,
        promptVersion: routeIntentPromptVersion,
        route: finalModelContract
      });
    }
    const protectedModelRoute = preserveProtectedLocalRoute(localRoute, modelRoute, normalized, context) || modelRoute;
    const safeForFallbackPromotion = isSafeShadowRoute(localRoute, protectedModelRoute, finalModelContract.confidence, reflectionFailed);
    const canPromote = safeForFallbackPromotion;
    const executedRoute = canPromote && protectedModelRoute ? protectedModelRoute : localRoute;
    await appendAssistantRouteShadowRecord({
      confidence: finalModelContract.confidence,
      disagreement: classifyRouteDisagreement(localRoute, protectedModelRoute),
      durationMs: Date.now() - startedAt,
      executedRoute,
      initialModelContract,
      inputText: normalized,
      localRoute,
      modelContract: finalModelContract,
      modelName,
      modelRoute: protectedModelRoute,
      promptVersion: routeIntentPromptVersion,
      reflectedModelContract,
      reflectionChanged: Boolean(reflectedModelContract && !sameRouteContract(initialModelContract, reflectedModelContract)),
      reflectionReason: reflectionReason || undefined,
      safeForFallbackPromotion
    });
    return executedRoute;
  } catch (error) {
    await appendAssistantRouteShadowRecord({
      confidence: 0,
      disagreement: "model_failed",
      durationMs: Date.now() - startedAt,
      executedRoute: semanticFallbackRoute(normalized, localRoute),
      failureReason: error instanceof Error ? error.message.slice(0, 180) : "unknown_model_failure",
      inputText: normalized,
      localRoute,
      modelContract: null,
      modelName,
      modelRoute: null,
      promptVersion: routeIntentPromptVersion,
      safeForFallbackPromotion: false
    });
    return semanticFallbackRoute(normalized, localRoute);
  }
}

function isSafeShadowRoute(localRoute: AssistantRoute, modelRoute: AssistantRoute | null, confidence: number, reflectionFailed = false) {
  if (!modelRoute) return false;
  if (modelRoute.kind === "fallback" && modelRoute.clarification) {
    return reflectionFailed || !isProtectedLocalRoute(localRoute);
  }
  if (confidence < 0.75) return false;
  if (modelRoute.kind === "fallback" && modelRoute.suggestedAction) {
    return localRoute.kind === "fallback" || (localRoute.kind === "action" && !isProtectedWriteAction(localRoute.id));
  }
  if (modelRoute.kind !== "action") return false;
  if (localRoute.kind === "action" && isProtectedWriteAction(localRoute.id)) return false;
  if (localRoute.kind === "pipeline" || localRoute.kind === "automation") return false;
  if (modelRoute.id === "profile.describe" && !modelRoute.parameters.member) return false;
  if (modelRoute.id === "app.answer" && (!modelRoute.parameters.queryType || modelRoute.parameters.queryType === "unknown")) return false;
  return isSafeReadOnlyAction(modelRoute.id);
}

export function assistantRouteReflectionReason(input: {
  context?: AssistantRouteContext;
  localRoute: AssistantRoute;
  modelContract: AssistantRouteContract;
  modelRoute: AssistantRoute | null;
  text: string;
  validationReason?: string | null;
}): AssistantRouteReflectionReason | null {
  if (input.validationReason === "low_confidence") return "low_confidence";
  if (isUnsafeWritePromotion(input.localRoute, input.modelRoute, input.text)) return "write_risk";
  if (input.modelContract.candidateActions.length !== 1) return "multiple_candidates";
  if (
    requiresContextResolution(input.text) &&
    Boolean(input.context?.recentConversation?.length || input.context?.recentUserTexts?.length) &&
    input.modelContract.confidence < 0.85
  ) {
    return "context_uncertainty";
  }
  if (
    classifyRouteDisagreement(input.localRoute, input.modelRoute) !== "none" &&
    input.modelContract.confidence < 0.82
  ) {
    return "route_disagreement";
  }
  return null;
}

function automationActionsForPrompt() {
  return automationActions;
}

function modelContractToAssistantRoute(contract: ReturnType<typeof describeAssistantRouteContract>, text: string): AssistantRoute | null {
  const actionId = contract.candidateActions[0];
  if (!actionId) {
    return null;
  }
  if (contract.confidence < 0.65 || contract.intent.includes("ambiguous")) {
    return {
      kind: "fallback",
      clarification: buildAssistantClarification(text),
      reason: "assignment_or_search"
    };
  }
  if (actionId === "task.create.input" || actionId === "memory.save" || actionId === "invite.create") {
    return {
      kind: "fallback",
      reason: "assignment_or_search",
      suggestedAction:
        actionId === "task.create.input"
          ? "task.create.input"
          : actionId === "memory.save"
            ? "memory.save"
            : undefined
    };
  }
  return {
    kind: "action",
    id: actionId,
    parameters: {
      member: readString(contract.entities.member) || undefined,
      queryType: readAppAnswerQueryType(contract.entities.queryType),
      recordDate: readIsoDate(contract.entities.recordDate),
      text
    }
  };
}

function requiresContextResolution(text: string) {
  const compact = text.replace(/\s+/g, "");
  const hasMixedScript = /[a-z]/i.test(compact) && /[\u4e00-\u9fff]/.test(compact);
  const hasReferenceOrCorrection = /(?:他|她|它|这个|那个|这条|那条|刚才|上面|呢|不是|不对|改成|换成|还是)/.test(compact);
  return compact.length <= 8 || hasMixedScript || hasReferenceOrCorrection;
}

function requiresSemanticModelResolution(text: string) {
  const normalized = text.replace(/\s+/g, "").replace(/[。.!！?？]+$/, "");
  return isAmbiguousOrganizationRequest(normalized) || /(?:总结|汇总|复盘)/.test(normalized);
}

function semanticFallbackRoute(text: string, localRoute: AssistantRoute) {
  return requiresSemanticModelResolution(text) ? clarificationFallback(text) : localRoute;
}

function clarificationFallback(text: string): AssistantRoute {
  return {
    kind: "fallback",
    clarification: buildAssistantClarification(text),
    reason: "assignment_or_search"
  };
}

function isUnsafeWritePromotion(localRoute: AssistantRoute, modelRoute: AssistantRoute | null, text: string) {
  if (!modelRoute) return false;
  const suggestsWrite =
    (modelRoute.kind === "fallback" && Boolean(modelRoute.suggestedAction)) ||
    (modelRoute.kind === "action" && !isSafeReadOnlyAction(modelRoute.id));
  if (!suggestsWrite) return false;
  if (isProtectedLocalRoute(localRoute) || isExplicitTaskCommand(text)) return false;
  return true;
}

function isProtectedLocalRoute(route: AssistantRoute) {
  if (route.kind === "pipeline" || route.kind === "automation") return true;
  if (route.kind === "fallback") return Boolean(route.suggestedAction);
  return isProtectedWriteAction(route.id);
}

function isSummaryAction(actionId: AutomationActionId) {
  return summaryActionIds.has(actionId);
}

function isSafeReadOnlyAction(actionId: AutomationActionId) {
  return ["app.chat", "app.answer", "profile.describe", "web.search.duckduckgo"].includes(actionId) || isSummaryAction(actionId);
}

function sameRouteContract(left: AssistantRouteContract, right: AssistantRouteContract) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function boundedTimeout(value: number, upperBound: number) {
  if (!Number.isFinite(value) || value <= 0) return upperBound;
  return Math.max(800, Math.min(Math.round(value), upperBound));
}


function readAppAnswerQueryType(value: unknown): AppAnswerQueryType | undefined {
  if (
    value === "app.capabilities" ||
    value === "system.time" ||
    value === "system.date" ||
    value === "members.count" ||
    value === "members.list" ||
    value === "members.online" ||
    value === "profiles.available" ||
    value === "tasks.outgoing" ||
    value === "tasks.incoming" ||
    value === "tasks.pending" ||
    value === "tasks.help" ||
    value === "resources.list" ||
    value === "records.recent" ||
    value === "api.usage" ||
    value === "unknown"
  ) {
    return value;
  }
  return undefined;
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readIsoDate(value: unknown) {
  const text = readString(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
}

function preserveProtectedLocalRoute(localRoute: AssistantRoute, modelRoute: AssistantRoute | null, text: string, context: AssistantRouteContext) {
  if (localRoute.kind === "pipeline" && localRoute.id === "pipeline.meta.profile_learning") {
    return localRoute;
  }
  if (localRoute.kind === "action" && isProtectedWriteAction(localRoute.id)) {
    return localRoute;
  }
  if (
    localRoute.kind === "fallback" &&
    (localRoute.suggestedAction === "task.create.input" || localRoute.suggestedAction === "memory.save")
  ) {
    return localRoute;
  }
  if (localRoute.kind === "action" && localRoute.id === "profile.describe") {
    return localRoute;
  }
  if (
    localRoute.kind === "action" &&
    localRoute.id === "app.answer" &&
    localRoute.parameters.queryType === "records.recent" &&
    localRoute.parameters.recordDate
  ) {
    return localRoute;
  }
  if (
    localRoute.kind === "action" &&
    localRoute.id === "app.chat" &&
    !(modelRoute?.kind === "action" && isSummaryAction(modelRoute.id)) &&
    (
      isConversationContextQuestion(text) ||
      isFamilyKnowledgeRecallQuestion(text) ||
      isShortContextContinuation(text, context) ||
      isUnconfirmedPersonalFactStatement(text) ||
      (modelRoute?.kind === "action" && modelRoute.id === "web.search.duckduckgo")
    )
  ) {
    return localRoute;
  }
  if (!modelRoute && localRoute.kind !== "fallback") {
    return localRoute;
  }
  return null;
}

function isProtectedWriteAction(actionId: AutomationActionId) {
  return !isSafeReadOnlyAction(actionId);
}

function describeRoute(route: AssistantRoute) {
  if (route.kind === "action") {
    return {
      action_id: route.id,
      kind: route.kind,
      member: route.parameters.member,
      query_type: route.parameters.queryType
    };
  }
  if (route.kind === "pipeline") {
    return {
      kind: route.kind,
      pipeline_id: route.id
    };
  }
  if (route.kind === "automation") {
    return {
      kind: route.kind,
      unit_id: route.unit.id
    };
  }
  return {
    kind: route.kind,
    reason: route.reason
  };
}
