import type { AutomationActionId } from "./automationRegistry";
import { familyFetch } from "./familyApi";

export type AutomationDisplayTarget = "inline_assistant" | "task_list" | "resource_list" | "group_chat" | "modal" | "toast" | "none";
export type AutomationDisplayType =
  | "chat_reply"
  | "task_candidate"
  | "task_item"
  | "resource_item"
  | "profile_card"
  | "summary_card"
  | "web_search_result"
  | "confirmation_card"
  | "error_card";

export type AutomationDisplay = {
  target: AutomationDisplayTarget;
  type: AutomationDisplayType;
  dismissible?: boolean;
  requiresConfirmation?: boolean;
};

export type AutomationActionResponse = {
  ok: boolean;
  actionId?: string;
  pipelineId?: string;
  display?: AutomationDisplay;
  status?: string;
  userReply?: string;
  data?: unknown;
  error?: string;
  confirmation?: {
    actionId?: string;
    pipelineId?: string;
    parameters: Record<string, unknown>;
    token: string;
  };
};

export async function runAutomationAction(
  actionId: AutomationActionId,
  parameters: Record<string, unknown> = {},
  options: { actorMemberId?: string; actorName?: string; confirmationToken?: string } = {}
): Promise<AutomationActionResponse | null> {
  const res = await familyFetch("/api/automation-actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action_id: actionId,
      actor_member_id: options.actorMemberId || "me",
      actor_name: options.actorName || "",
      assistant_interpretation: buildClientInterpretation("action", actionId, parameters),
      confirmation_token: options.confirmationToken,
      parameters
    })
  });

  if (!res.ok) {
    return automationErrorResponse(res);
  }

  return normalizeAutomationResponse(await res.json());
}

export async function runAutomationPipeline(
  pipelineId: string,
  parameters: Record<string, unknown> = {},
  options: { actorMemberId?: string; actorName?: string; confirmationToken?: string } = {}
): Promise<AutomationActionResponse | null> {
  const res = await familyFetch("/api/automation-actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pipeline_id: pipelineId,
      actor_member_id: options.actorMemberId || "me",
      actor_name: options.actorName || "",
      assistant_interpretation: buildClientInterpretation("pipeline", pipelineId, parameters),
      confirmation_token: options.confirmationToken,
      parameters
    })
  });

  if (!res.ok) {
    return automationErrorResponse(res);
  }

  return normalizeAutomationResponse(await res.json());
}

async function automationErrorResponse(response: Response): Promise<AutomationActionResponse> {
  let detail = `请求失败（${response.status}）`;
  try {
    const payload = await response.json() as { detail?: unknown; error?: unknown };
    const message = typeof payload.detail === "string" ? payload.detail : typeof payload.error === "string" ? payload.error : "";
    if (message) detail = message;
  } catch {
    // Keep the HTTP status fallback when the server did not return JSON.
  }
  return {
    ok: false,
    display: { target: "inline_assistant", type: "error_card", dismissible: true },
    error: detail,
    userReply: detail
  };
}

function normalizeAutomationResponse(payload: unknown): AutomationActionResponse {
  if (!payload || typeof payload !== "object") {
    return {
      ok: false,
      display: { target: "inline_assistant", type: "error_card", dismissible: true },
      error: "自动化返回格式无效。"
    };
  }

  const objectPayload = payload as {
    action_id?: string;
    actionId?: string;
    data?: unknown;
    display?: AutomationDisplay;
    error?: string;
    confirmation?: AutomationActionResponse["confirmation"];
    ok?: boolean;
    pipeline_id?: string;
    pipelineId?: string;
    result?: unknown;
    userReply?: string;
  };

  if ("ok" in objectPayload) {
    return {
      ok: Boolean(objectPayload.ok),
      actionId: objectPayload.actionId || objectPayload.action_id,
      pipelineId: objectPayload.pipelineId || objectPayload.pipeline_id,
      display: objectPayload.display,
      status: readStringProperty(objectPayload, "status"),
      userReply: objectPayload.userReply,
      data: objectPayload.data,
      error: objectPayload.error,
      confirmation: objectPayload.confirmation
    };
  }

  const legacyResult = objectPayload.result;
  const legacyPayload = readLegacyResultPayload(legacyResult);
  return {
    ok: Boolean(legacyResult),
    actionId: objectPayload.action_id || readStringProperty(legacyResult, "actionId"),
    pipelineId: objectPayload.pipeline_id || readStringProperty(legacyResult, "pipelineId"),
    display: readAutomationDisplay(legacyPayload),
    userReply: readStringProperty(legacyPayload, "text"),
    data: legacyPayload ?? legacyResult
  };
}

function readLegacyResultPayload(result: unknown) {
  if (result && typeof result === "object" && "result" in result) {
    return (result as { result?: unknown }).result;
  }
  return result;
}

function readAutomationDisplay(payload: unknown): AutomationDisplay | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const display = (payload as { display?: unknown }).display;
  if (display && typeof display === "object") {
    const target = (display as { target?: unknown }).target;
    const type = (display as { type?: unknown }).type;
    if (isAutomationDisplayTarget(target) && isAutomationDisplayType(type)) {
      return display as AutomationDisplay;
    }
  }
  const target = (payload as { displayTarget?: unknown }).displayTarget;
  const type = (payload as { displayType?: unknown }).displayType;
  if (isAutomationDisplayTarget(target) && isAutomationDisplayType(type)) {
    return { target, type };
  }
  return undefined;
}

function readStringProperty(payload: unknown, key: string) {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function isAutomationDisplayTarget(value: unknown): value is AutomationDisplayTarget {
  return value === "inline_assistant" || value === "task_list" || value === "resource_list" || value === "group_chat" || value === "modal" || value === "toast" || value === "none";
}

function isAutomationDisplayType(value: unknown): value is AutomationDisplayType {
  return (
    value === "chat_reply" ||
    value === "task_candidate" ||
    value === "task_item" ||
    value === "resource_item" ||
    value === "profile_card" ||
    value === "summary_card" ||
    value === "web_search_result" ||
    value === "confirmation_card" ||
    value === "error_card"
  );
}

function buildClientInterpretation(unit: "action" | "pipeline", id: string, parameters: Record<string, unknown>) {
  const text = typeof parameters.text === "string" ? parameters.text.trim() : "";
  return {
    candidate_actions: [
      {
        id,
        unit
      }
    ],
    confidence: 0.7,
    intent: unit === "action" ? [{ action_id: id }] : [{ pipeline_id: id }],
    output: {
      parameters
    },
    reason: "client route selected by existing assistant routing flow",
    route_source: "client",
    summary: text.slice(0, 120),
    tags: []
  };
}
