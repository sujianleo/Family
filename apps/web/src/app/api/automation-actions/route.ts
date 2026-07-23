import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { automationPipelines, getAutomationAction } from "@/lib/automationRegistry";
import type { AutomationActionResponse, AutomationDisplay } from "@/lib/automations";
import { issueConfirmationToken, verifyConfirmationToken } from "@/lib/server/confirmationGate";
import { requireFamilyRequestContext, FamilyRequestContextError } from "@/lib/server/familyRequestContext";
import { createAssistantInterpretation, createAutomationRun, createRawEvent } from "@/lib/server/eventStore";
import { runAutomationAction, runAutomationPipeline } from "@/lib/server/automationRunner";
import { extractKnowledgeCandidate } from "@/lib/server/assistantExtractors";
import { invokeDeepSeekJson } from "@/lib/server/langchainAi";
import { detectDangerousOperation } from "@/lib/safetyGuard";
import { readFamilyMembersForContext } from "@/lib/server/familyMembers";
import { appActionCatalog } from "@/lib/appActionCatalog";
import { prepareConversationContext } from "@/lib/server/conversationMemory";
import { resolveContextualKnowledgeInput } from "@/lib/server/contextualKnowledge";

type AutomationActionRequest = {
  action_id?: string;
  pipeline_id?: string;
  actor_member_id?: string;
  actor_name?: string;
  confirmation_token?: string;
  assistant_interpretation?: {
    candidate_actions?: unknown[];
    confidence?: number;
    intent?: unknown;
    matched_rule?: string;
    output?: Record<string, unknown>;
    reason?: string;
    route_source?: string;
    summary?: string;
    tags?: unknown[];
  };
  parameters?: Record<string, unknown>;
};

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    actions: appActionCatalog,
    ai_callable_action_ids: appActionCatalog.filter((action) => action.aiCallable).map((action) => action.id),
    pipelines: automationPipelines,
    summary: {
      actions: appActionCatalog.length,
      aiCallable: appActionCatalog.filter((action) => action.aiCallable).length,
      discoveredOnly: appActionCatalog.filter((action) => !action.aiCallable).length
    }
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AutomationActionRequest;
    const context = await requireFamilyRequestContext(request);
    const requestedLocalMemberId = readString(body.actor_member_id);
    const actorMemberId =
      context.userId === "local-development" && requestedLocalMemberId ? requestedLocalMemberId : context.memberId;
    const actorName =
      (await readFamilyMembersForContext(context)).find((member) => member.id === actorMemberId)?.displayName ||
      actorMemberId;
    const actionId = readString(body.action_id);
    const pipelineId = readString(body.pipeline_id);
    let parameters = body.parameters || {};
    const rawEvent = await createRawEvent({
      actorMemberId: actorMemberId || null,
      actorName: actorName || null,
      conversationId: readString(parameters.session_id) || null,
      familyId: context.familyId || null,
      rawPayload: {
        action_id: actionId || null,
        parameters,
        pipeline_id: pipelineId || null
      },
      rawText: readString(parameters.text) || actionId || pipelineId,
      serverMetadata: {
        entrypoint: "/api/automation-actions"
      },
      sourceType: pipelineId ? "automation.pipeline_request" : "automation.action_request"
    });
    const interpretation = body.assistant_interpretation
      ? await createAssistantInterpretation({
          candidateActions: body.assistant_interpretation.candidate_actions,
          confidence: body.assistant_interpretation.confidence,
          intent: body.assistant_interpretation.intent,
          matchedRule: body.assistant_interpretation.matched_rule,
          output: body.assistant_interpretation.output,
          familyId: context.familyId || null,
          rawEventId: rawEvent.id,
          reason: body.assistant_interpretation.reason,
          routeSource: body.assistant_interpretation.route_source || "client",
          summary: body.assistant_interpretation.summary,
          tags: body.assistant_interpretation.tags
        })
      : null;

    if (pipelineId) {
      const pipeline = automationPipelines.find((item) => item.id === pipelineId);
      if (!pipeline) {
        return NextResponse.json({ detail: "未知自动化流程。" }, { status: 400 });
      }
      const requiresConfirmation = pipeline.steps.some((step) => getAutomationAction(step.actionId)?.requiresConfirmation);
      if (requiresConfirmation && !hasValidConfirmation(body, { actorMemberId, parameters, pipelineId })) {
        return NextResponse.json(await createConfirmationResponse({ context: { ...context, memberId: actorMemberId }, pipelineId, parameters, rawEventId: rawEvent.id }));
      }
      const result = await runAutomationPipeline(pipeline.id, {
        actorMemberId: actorMemberId || null,
        actorName: actorName || null,
        familyId: context.familyId || null,
        confirmed: requiresConfirmation,
        interpretationId: interpretation?.id || null,
        parameters,
        rawEventId: rawEvent.id
      });
      return NextResponse.json(buildPipelineResponse(pipeline.id, result));
    }

    const action = getAutomationAction(actionId);

    if (!action) {
      return NextResponse.json({ detail: "未知自动化动作。" }, { status: 400 });
    }

    if (action.kind !== "server") {
      return NextResponse.json({ detail: "这个动作需要在前端界面内执行。" }, { status: 400 });
    }
    if (action.id !== "safety.dangerous_operation" && detectDangerousOperation(readString(parameters.text))) {
      const result = await runAutomationAction("safety.dangerous_operation", {
        actorMemberId: actorMemberId || null,
        actorName: actorName || null,
        familyId: context.familyId || null,
        interpretationId: interpretation?.id || null,
        parameters,
        rawEventId: rawEvent.id
      });
      return NextResponse.json(buildActionResponse("safety.dangerous_operation", result));
    }
    if (action.requiresConfirmation && !hasValidConfirmation(body, { actionId: action.id, actorMemberId, parameters })) {
      if (action.id === "memory.save") {
        const sessionId = readString(parameters.session_id);
        const conversationContext = sessionId
          ? await prepareConversationContext({
              actorMemberId,
              dataDir: "data",
              sessionId
            })
          : undefined;
        const contextualResolution = resolveContextualKnowledgeInput(
          readString(parameters.text),
          conversationContext
        );
        const candidate = await extractKnowledgeCandidate(
          {
            subject: contextualResolution?.subject || readString(parameters.subject),
            text: contextualResolution?.text || readString(parameters.text)
          },
          {
            invokeModel: async ({ prompt, userInput }) => invokeDeepSeekJson(
              [
                { role: "system", content: prompt },
                { role: "user", content: userInput }
              ],
              {
                familyId: context.familyId || null,
                maxTokens: 320,
                operation: "knowledge.extract.confirmation",
                temperature: 0.1,
                timeoutMs: 4500
              }
            )
          }
        );
        parameters = {
          ...parameters,
          evidence_text: contextualResolution?.evidenceText || candidate.evidenceText,
          fact: candidate.fact,
          memory_type: candidate.memoryType,
          source_raw_event_id: rawEvent.id,
          subject: candidate.subject,
          tags: candidate.tags
        };
      }
      return NextResponse.json(await createConfirmationResponse({ actionId: action.id, context: { ...context, memberId: actorMemberId }, parameters, rawEventId: rawEvent.id }));
    }

    const result = await runAutomationAction(action.id, {
      actorMemberId: actorMemberId || null,
      actorName: actorName || null,
      familyId: context.familyId || null,
      interpretationId: interpretation?.id || null,
      parameters,
      rawEventId: rawEvent.id,
      confirmed: action.requiresConfirmation
    });

    return NextResponse.json(buildActionResponse(action.id, result));
  } catch (error) {
    if (error instanceof FamilyRequestContextError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: error instanceof Error ? error.message : "自动化执行失败。" }, { status: 500 });
  }
}

function hasValidConfirmation(
  body: AutomationActionRequest,
  input: { actionId?: string; actorMemberId: string; parameters: Record<string, unknown>; pipelineId?: string }
) {
  const token = readString(body.confirmation_token);
  return token ? verifyConfirmationToken(token, input) : false;
}

async function createConfirmationResponse(input: {
  actionId?: string;
  context: { familyId: string; memberId: string };
  parameters: Record<string, unknown>;
  pipelineId?: string;
  rawEventId: string;
}): Promise<AutomationActionResponse> {
  const parameters =
    input.actionId?.startsWith("task.create.") && !readString(input.parameters.command_id)
      ? { ...input.parameters, command_id: randomUUID() }
      : input.parameters;
  const candidate = input.actionId === "memory.save"
    ? {
        evidenceText: readString(parameters.evidence_text),
        fact: readString(parameters.fact),
        memoryType: readString(parameters.memory_type),
        subject: readString(parameters.subject),
        tags: Array.isArray(parameters.tags) ? parameters.tags.map(String).filter(Boolean) : []
      }
    : null;
  const resourceOwnerCandidate = input.actionId === "resource.assign_owner"
    ? {
        ownerName: readString(parameters.owner_name),
        resourceTitle: readString(parameters.resource_title)
      }
    : null;
  const confirmation = {
    actionId: input.actionId,
    parameters,
    pipelineId: input.pipelineId,
    token: issueConfirmationToken({
      actionId: input.actionId,
      actorMemberId: input.context.memberId,
      parameters,
      pipelineId: input.pipelineId
    })
  };
  await createAutomationRun({
    actionId: input.actionId || null,
    familyId: input.context.familyId || null,
    input: parameters,
    pipelineId: input.pipelineId || null,
    rawEventId: input.rawEventId,
    requiresConfirmation: true,
    sideEffectLevel: input.actionId ? getAutomationAction(input.actionId)?.sideEffectLevel || "medium" : "medium",
    status: "waiting_confirmation"
  });
  return {
    ok: true,
    actionId: input.actionId,
    pipelineId: input.pipelineId,
    confirmation,
    data: candidate ? { candidate, confirmation } : { confirmation },
    display: { target: "inline_assistant", type: "confirmation_card", dismissible: true, requiresConfirmation: true },
    status: "waiting_confirmation",
    userReply: candidate?.fact
      ? `我先把这条放在待确认里，还没有写进长期记忆：\n${candidate.subject}：${candidate.fact}\n如果这是稳定的${formatMemoryType(candidate.memoryType)}，你确认后我再记住。`
      : resourceOwnerCandidate?.ownerName
        ? `准备把《${resourceOwnerCandidate.resourceTitle || "这份资料"}》的归属改为${resourceOwnerCandidate.ownerName}。确认后才会写入。`
      : "此操作会修改家庭数据，请确认后再执行。"
  };
}

function formatMemoryType(value: string) {
  const labels: Record<string, string> = {
    family_fact: "家庭事实",
    habit: "长期习惯",
    health: "健康信息",
    location: "位置资料",
    note: "长期备注",
    preference: "长期偏好"
  };
  return labels[value] || "长期资料";
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function buildActionResponse(actionId: string, result: { actionId?: string; result?: unknown; status?: string }): AutomationActionResponse {
  const data = result.result;
  return {
    ok: result.status !== "blocked",
    actionId: result.actionId || actionId,
    display: readAutomationDisplay(data),
    status: result.status,
    userReply: readUserReply(data),
    data,
    error: result.status === "blocked" ? readUserReply(data) : undefined
  };
}

function buildPipelineResponse(pipelineId: string, result: { display?: AutomationDisplay; results?: Array<{ result?: unknown }>; status?: string }): AutomationActionResponse {
  const display = result.display || result.results?.map((item) => readAutomationDisplay(item.result)).find(Boolean);
  const userReply = result.results?.map((item) => readUserReply(item.result)).find(Boolean);
  return {
    ok: result.status === "completed",
    pipelineId,
    display,
    status: result.status,
    userReply,
    data: result
  };
}

function readAutomationDisplay(data: unknown): AutomationDisplay | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }
  const display = (data as { display?: unknown }).display;
  if (display && typeof display === "object" && "target" in display && "type" in display) {
    return display as AutomationDisplay;
  }
  return undefined;
}

function readUserReply(data: unknown) {
  if (!data || typeof data !== "object") {
    return undefined;
  }
  const text = (data as { text?: unknown }).text;
  return typeof text === "string" ? text : undefined;
}
