import { appendFile, mkdir } from "node:fs/promises";
import { createServiceExternalStoreClient } from "./externalStoreServer";

export type RawEventInput = {
  actorMemberId?: string | null;
  actorName?: string | null;
  clientMetadata?: Record<string, unknown>;
  conversationId?: string | null;
  dataDir?: string;
  familyId?: string | null;
  parentEventId?: string | null;
  rawPayload?: Record<string, unknown>;
  rawText?: string | null;
  serverMetadata?: Record<string, unknown>;
  sourceSpaceId?: string | null;
  sourceType: string;
};

export type AssistantInterpretationInput = {
  actionButtons?: unknown[];
  candidateActions?: unknown[];
  confidence?: number | null;
  dataDir?: string;
  entities?: Record<string, unknown>;
  familyId?: string | null;
  inputHash?: string | null;
  intent?: unknown;
  matchedRule?: string | null;
  modelName?: string | null;
  mood?: string | null;
  output?: Record<string, unknown>;
  promptVersion?: string | null;
  rawEventId?: string | null;
  reason?: string | null;
  routeSource?: string | null;
  summary?: string | null;
  tags?: unknown[];
};

export type AutomationRunInput = {
  actionId?: string | null;
  dataDir?: string;
  errorMessage?: string | null;
  familyId?: string | null;
  input?: Record<string, unknown>;
  interpretationId?: string | null;
  modelName?: string | null;
  output?: unknown;
  pipelineId?: string | null;
  promptVersion?: string | null;
  rawEventId?: string | null;
  requiresConfirmation?: boolean;
  sideEffectLevel?: string;
  startedAt?: string | null;
  status: "pending" | "running" | "success" | "failed" | "canceled" | "waiting_confirmation";
};

export type SummaryInput = {
  actorMemberId?: string | null;
  dataDir?: string;
  endTime: string;
  familyId?: string | null;
  modelName: string;
  promptVersion: string;
  scope: "personal" | "family";
  sourceEventIds?: string[];
  sourceMessageIds?: string[];
  sourceRecordIds?: string[];
  sourceResourceIds?: string[];
  sourceTaskIds?: string[];
  startTime: string;
  summaryJson: Record<string, unknown>;
  summaryText: string;
  summaryType: "daily" | "weekly" | "monthly" | "yearly" | "custom";
};

const defaultDataDir = "data";

export async function createRawEvent(input: RawEventInput) {
  const event = {
    id: createEventId("raw"),
    actor_member_id: normalizeUuid(input.actorMemberId),
    actor_member_key: input.actorMemberId || null,
    actor_name: input.actorName || null,
    client_metadata_json: input.clientMetadata || {},
    conversation_id: input.conversationId || null,
    family_id: normalizeUuid(input.familyId),
    parent_event_id: normalizeUuid(input.parentEventId),
    raw_payload_json: input.rawPayload || {},
    raw_text: input.rawText || null,
    server_metadata_json: input.serverMetadata || {},
    source_space_id: normalizeUuid(input.sourceSpaceId),
    source_space_key: input.sourceSpaceId || null,
    source_type: input.sourceType
  };

  await insertExternalStoreRow("raw_events", event);
  await appendDebugJsonl(input.dataDir || defaultDataDir, "raw-events.jsonl", { ...event, created_at: new Date().toISOString() });
  return { id: event.id };
}

export async function createAssistantInterpretation(input: AssistantInterpretationInput) {
  const interpretation = {
    id: createEventId("interp"),
    action_buttons_json: input.actionButtons || [],
    candidate_actions_json: input.candidateActions || [],
    confidence: normalizeConfidence(input.confidence),
    entities_json: input.entities || {},
    family_id: normalizeUuid(input.familyId),
    input_hash: input.inputHash || null,
    intent_json: input.intent ?? [],
    matched_rule: input.matchedRule || null,
    model_name: input.modelName || null,
    mood: input.mood || null,
    output_json: input.output || {},
    prompt_version: input.promptVersion || null,
    raw_event_id: normalizeUuid(input.rawEventId),
    raw_event_key: input.rawEventId || null,
    reason: input.reason || null,
    route_source: input.routeSource || null,
    summary: input.summary || null,
    tags_json: input.tags || []
  };

  await insertExternalStoreRow("assistant_interpretations", interpretation);
  await appendDebugJsonl(input.dataDir || defaultDataDir, "assistant-interpretations.jsonl", {
    ...interpretation,
    created_at: new Date().toISOString()
  });
  return { id: interpretation.id };
}

export async function createAutomationRun(input: AutomationRunInput) {
  const startedAt = input.startedAt || new Date().toISOString();
  const run = {
    id: createEventId("run"),
    action_id: input.actionId || null,
    error_message: input.errorMessage || null,
    family_id: normalizeUuid(input.familyId),
    finished_at: input.status === "running" || input.status === "pending" ? null : new Date().toISOString(),
    input_json: input.input || {},
    interpretation_id: normalizeUuid(input.interpretationId),
    interpretation_key: input.interpretationId || null,
    model_name: input.modelName || null,
    output_json: normalizeOutput(input.output),
    pipeline_id: input.pipelineId || null,
    prompt_version: input.promptVersion || null,
    raw_event_id: normalizeUuid(input.rawEventId),
    raw_event_key: input.rawEventId || null,
    requires_confirmation: Boolean(input.requiresConfirmation),
    side_effect_level: input.sideEffectLevel || "low",
    started_at: startedAt,
    status: input.status
  };

  await insertExternalStoreRow("automation_runs", run);
  await appendDebugJsonl(input.dataDir || defaultDataDir, "automation-runs.jsonl", {
    ...run,
    created_at: new Date().toISOString(),
    duration_ms: run.finished_at ? new Date(run.finished_at).getTime() - new Date(startedAt).getTime() : null,
    phase: input.status === "success" ? "completed" : input.status,
    result_status: readResultStatus(input.output)
  });
  return { id: run.id };
}

export async function createSummary(input: SummaryInput) {
  const summary = {
    id: createEventId("summary"),
    actor_member_id: normalizeUuid(input.actorMemberId),
    actor_member_key: input.actorMemberId || null,
    created_at: new Date().toISOString(),
    end_time: input.endTime,
    family_id: normalizeUuid(input.familyId),
    family_key: input.familyId || null,
    model_name: input.modelName,
    prompt_version: input.promptVersion,
    scope: input.scope,
    source_event_ids_json: input.sourceEventIds || [],
    source_message_ids_json: input.sourceMessageIds || [],
    source_record_ids_json: input.sourceRecordIds || [],
    source_resource_ids_json: input.sourceResourceIds || [],
    source_task_ids_json: input.sourceTaskIds || [],
    start_time: input.startTime,
    summary_json: input.summaryJson,
    summary_text: input.summaryText,
    summary_type: input.summaryType
  };

  await insertExternalStoreRow("summaries", summary);
  await appendDebugJsonl(input.dataDir || defaultDataDir, "summaries.jsonl", summary);
  return { id: summary.id };
}

async function insertExternalStoreRow(table: string, row: Record<string, unknown>) {
  const externalStore = createServiceExternalStoreClient();
  if (!externalStore || !row.family_id) {
    return;
  }

  const { error } = await externalStore.from(table).insert(stripUndefined(row));
  if (error) {
    await appendDebugJsonl(defaultDataDir, "event-store-errors.jsonl", {
      created_at: new Date().toISOString(),
      detail: error.message,
      table
    });
  }
}

async function appendDebugJsonl(dataDir: string, fileName: string, row: Record<string, unknown>) {
  await mkdir(dataDir, { recursive: true });
  await appendFile(`${dataDir}/${fileName}`, `${JSON.stringify(stripUndefined(row))}\n`, "utf8");
}

function createEventId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeUuid(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function normalizeConfidence(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
}

function normalizeOutput(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : { value };
}

function readResultStatus(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const result = (value as Record<string, unknown>).result;
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return null;
  }
  const status = (result as Record<string, unknown>).status;
  return typeof status === "string" ? status : null;
}

function stripUndefined<T extends Record<string, unknown>>(row: T) {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
}
