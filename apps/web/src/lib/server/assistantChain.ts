import { automationActions, automationUnits, type AutomationActionId } from "../automationRegistry";
import {
  type AppAnswerQueryType,
  type AssistantRouteContext,
  type AssistantRoute,
  buildAssistantClarification,
  describeAssistantRouteContract,
  isConversationContextQuestion,
  isFamilyKnowledgeRecallQuestion,
  isShortContextContinuation,
  isUnconfirmedPersonalFactStatement,
  routeAssistantInput
} from "../assistantRouter";
import { detectDangerousOperation } from "../safetyGuard";
import { isTimedTaskStatement } from "../taskIntent";
import type { FamilyMember } from "../types";
import { invokeRouteChain } from "./ai/chains/route.chain";
import { createFastModel } from "./ai/models";
import { getFastModelName } from "./langchainAi";
import { listFamilyAutomationToolNames } from "./langchainTools";
import { hashFamilyContext, readCachedAssistantRoute, writeCachedAssistantRoute } from "./assistantRouteCache";
import {
  appendAssistantRouteShadowRecord,
  classifyRouteDisagreement
} from "./assistantRouteShadow";

const routeIntentPromptVersion = "route-intent-v2";

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
  if (localRoute.kind === "action" && localRoute.id.startsWith("summary.")) {
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
    (hasDialogueContext && requiresContextResolution(normalized));
  if (!shouldShadow) {
    return localRoute;
  }

  const model = createFastModel({
    maxTokens: 600,
    temperature: 0.1,
    timeoutMs: Number(process.env.DEEPSEEK_ROUTER_TIMEOUT_MS || process.env.DEEPSEEK_TIMEOUT_MS || 5000)
  });
  if (!model) {
    return localRoute;
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
    const validatedRoute = cachedRoute
      ? { ok: true as const, route: cachedRoute }
      : await invokeRouteChain(
          {
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
          },
          {
            availableUnits: automationUnits.map((unit) => ({
              id: unit.id,
              label: unit.label,
              unit: unit.unit
            })),
            deterministicHint: describeRoute(localRoute),
            toolNames: listFamilyAutomationToolNames()
          },
          {
            maxTokens: 600,
            timeoutMs: Number(process.env.DEEPSEEK_ROUTER_TIMEOUT_MS || process.env.DEEPSEEK_TIMEOUT_MS || 5000)
          }
        );
    if (!validatedRoute.ok && validatedRoute.reason !== "low_confidence") throw new Error(validatedRoute.reason);
    if (!cachedRoute && validatedRoute.ok) {
      await writeCachedAssistantRoute({
        familyContextHash,
        inputText: normalized,
        modelName,
        promptVersion: routeIntentPromptVersion,
        route: validatedRoute.route
      });
    }
    const modelRoute = modelContractToAssistantRoute(validatedRoute.route, normalized);
    const protectedModelRoute = preserveProtectedLocalRoute(localRoute, modelRoute, normalized, context) || modelRoute;
    const safeForFallbackPromotion = isSafeShadowRoute(localRoute, protectedModelRoute, validatedRoute.route.confidence);
    const canPromote = safeForFallbackPromotion;
    const executedRoute = canPromote && protectedModelRoute ? protectedModelRoute : localRoute;
    await appendAssistantRouteShadowRecord({
      confidence: validatedRoute.route.confidence,
      disagreement: classifyRouteDisagreement(localRoute, protectedModelRoute),
      durationMs: Date.now() - startedAt,
      executedRoute,
      inputText: normalized,
      localRoute,
      modelContract: validatedRoute.route,
      modelName,
      modelRoute: protectedModelRoute,
      promptVersion: routeIntentPromptVersion,
      safeForFallbackPromotion
    });
    return executedRoute;
  } catch (error) {
    await appendAssistantRouteShadowRecord({
      confidence: 0,
      disagreement: "model_failed",
      durationMs: Date.now() - startedAt,
      executedRoute: localRoute,
      failureReason: error instanceof Error ? error.message.slice(0, 180) : "unknown_model_failure",
      inputText: normalized,
      localRoute,
      modelContract: null,
      modelName,
      modelRoute: null,
      promptVersion: routeIntentPromptVersion,
      safeForFallbackPromotion: false
    });
    return localRoute;
  }
}

function isSafeShadowRoute(localRoute: AssistantRoute, modelRoute: AssistantRoute | null, confidence: number) {
  if (!modelRoute || confidence < 0.75) return false;
  if (modelRoute.kind === "fallback" && modelRoute.suggestedAction) {
    return localRoute.kind === "fallback" || (localRoute.kind === "action" && !isProtectedWriteAction(localRoute.id));
  }
  if (modelRoute.kind !== "action") return false;
  if (localRoute.kind === "action" && isProtectedWriteAction(localRoute.id)) return false;
  if (localRoute.kind === "pipeline" || localRoute.kind === "automation") return false;
  if (modelRoute.id === "profile.describe" && !modelRoute.parameters.member) return false;
  if (modelRoute.id === "app.answer" && (!modelRoute.parameters.queryType || modelRoute.parameters.queryType === "unknown")) return false;
  return ["app.chat", "app.answer", "profile.describe", "web.search.duckduckgo"].includes(modelRoute.id);
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
  return !["app.chat", "app.answer", "profile.describe", "web.search.duckduckgo"].includes(actionId);
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
