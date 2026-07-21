import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createSummary } from "../eventStore";
import { createServiceSupabaseClient } from "../supabaseServer";
import {
  insightBatchSchema,
  insightCapabilitySchema,
  type InsightBatch,
  type InsightCapability,
  type InsightPresentation
} from "./insightSchema";
import type { InsightSourceBundle, InsightSourceType } from "./insightBuilder";

export type InsightCacheIdentity = {
  capability: InsightCapability;
  familyId: string;
  periodKey: string;
  promptVersion: string;
  sourceFingerprint: string;
};

export type StoredInsight = {
  batch: InsightBatch;
  capability: InsightCapability;
  createdAt: string;
  id: string;
  model: string;
  periodKey: string;
  presentation: InsightPresentation;
  promptVersion: string;
  sourceFingerprint: string;
  sourceIds: string[];
};

export function buildSourceFingerprint(sourceIds: string[]) {
  return createHash("sha256").update([...new Set(sourceIds)].sort().join("\n")).digest("hex").slice(0, 24);
}

export function buildInsightPresentation(capability: InsightCapability, batch: InsightBatch): InsightPresentation {
  const first = batch.insights[0];
  const userReply = first
    ? `饭米粒今天发现：${first.summary}`
    : "饭米粒今天没有发现需要特别提醒的变化。";
  return {
    data: {
      capability,
      insights: batch.insights,
      sourceIds: [...new Set(batch.insights.flatMap((insight) => insight.sourceIds))]
    },
    display: {
      dismissible: true,
      target: "inline_assistant",
      type: "summary_card"
    },
    title: "饭米粒今天发现",
    userReply
  };
}

export async function findCachedInsight(
  identity: InsightCacheIdentity,
  dataDir = "data"
): Promise<StoredInsight | null> {
  const supabase = createServiceSupabaseClient();
  if (supabase && isUuid(identity.familyId)) {
    const { data, error } = await supabase
      .from("summaries")
      .select("id, created_at, model_name, prompt_version, summary_json")
      .eq("family_id", identity.familyId)
      .eq("prompt_version", identity.promptVersion)
      .contains("summary_json", {
        capability: identity.capability,
        kind: "family_insight",
        periodKey: identity.periodKey
      })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!error && data) return parseStoredInsight(data);
  }

  const rows = await readJsonl(`${dataDir}/summaries.jsonl`);
  return rows
    .filter((row) => matchesFamily(row, identity.familyId))
    .map(parseStoredInsight)
    .filter(Boolean)
    .sort((left, right) => (right?.createdAt || "").localeCompare(left?.createdAt || ""))
    .find((record) =>
      record?.capability === identity.capability &&
      record.periodKey === identity.periodKey &&
      record.promptVersion === identity.promptVersion
    ) || null;
}

export async function listStoredInsights(
  familyId: string,
  limit = 7,
  dataDir = "data"
): Promise<StoredInsight[]> {
  const boundedLimit = Math.max(1, Math.min(31, limit));
  const supabase = createServiceSupabaseClient();
  if (supabase && isUuid(familyId)) {
    const { data, error } = await supabase
      .from("summaries")
      .select("id, created_at, model_name, prompt_version, summary_json")
      .eq("family_id", familyId)
      .contains("summary_json", { kind: "family_insight" })
      .order("created_at", { ascending: false })
      .limit(boundedLimit);
    if (!error && Array.isArray(data)) {
      return data.map(parseStoredInsight).filter((record): record is StoredInsight => record !== null);
    }
  }

  const rows = await readJsonl(`${dataDir}/summaries.jsonl`);
  return rows
    .filter((row) => matchesFamily(row, familyId))
    .map(parseStoredInsight)
    .filter((record): record is StoredInsight => record !== null)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, boundedLimit);
}

export async function storeInsight(input: {
  batch: InsightBatch;
  capability: InsightCapability;
  dataDir?: string;
  endTime: string;
  familyId: string;
  model: string;
  periodKey: string;
  promptVersion: string;
  source: InsightSourceBundle;
  sourceFingerprint: string;
  startTime: string;
}): Promise<StoredInsight> {
  const presentation = buildInsightPresentation(input.capability, input.batch);
  const sourceIds = [...new Set(input.batch.insights.flatMap((insight) => insight.sourceIds))];
  const summaryJson = {
    batch: input.batch,
    capability: input.capability,
    kind: "family_insight",
    model: input.model,
    periodKey: input.periodKey,
    presentation,
    promptVersion: input.promptVersion,
    sourceFingerprint: input.sourceFingerprint,
    sourceIds
  };
  const summary = await createSummary({
    actorMemberId: null,
    dataDir: input.dataDir,
    endTime: input.endTime,
    familyId: input.familyId,
    modelName: input.model,
    promptVersion: input.promptVersion,
    scope: "family",
    sourceEventIds: idsByType(input.source, "raw_event", sourceIds),
    sourceMessageIds: idsByType(input.source, "message", sourceIds),
    sourceRecordIds: idsByType(input.source, "record", sourceIds),
    sourceResourceIds: idsByType(input.source, "resource", sourceIds),
    sourceTaskIds: idsByType(input.source, "task", sourceIds),
    startTime: input.startTime,
    summaryJson,
    summaryText: presentation.userReply,
    summaryType: input.capability === "family.insight.daily"
      ? "daily"
      : input.capability === "family.insight.weekly"
        ? "weekly"
        : "custom"
  });
  return {
    batch: input.batch,
    capability: input.capability,
    createdAt: new Date().toISOString(),
    id: summary.id,
    model: input.model,
    periodKey: input.periodKey,
    presentation,
    promptVersion: input.promptVersion,
    sourceFingerprint: input.sourceFingerprint,
    sourceIds
  };
}

function parseStoredInsight(row: Record<string, unknown>): StoredInsight | null {
  const summaryJson = readObject(row.summary_json);
  if (summaryJson?.kind !== "family_insight") return null;
  const capability = insightCapabilitySchema.safeParse(summaryJson.capability);
  const batch = insightBatchSchema.safeParse(summaryJson.batch);
  if (!capability.success || !batch.success) return null;
  const presentation = buildInsightPresentation(capability.data, batch.data);
  return {
    batch: batch.data,
    capability: capability.data,
    createdAt: readString(row.created_at) || new Date(0).toISOString(),
    id: readString(row.id) || "",
    model: readString(row.model_name) || readString(summaryJson.model) || "unknown",
    periodKey: readString(summaryJson.periodKey) || "",
    presentation,
    promptVersion: readString(row.prompt_version) || readString(summaryJson.promptVersion) || "",
    sourceFingerprint: readString(summaryJson.sourceFingerprint) || "",
    sourceIds: readStringArray(summaryJson.sourceIds)
  };
}

function idsByType(source: InsightSourceBundle, sourceType: InsightSourceType, allowedIds: string[]) {
  const allowed = new Set(allowedIds);
  return source.items
    .filter((item) => item.sourceType === sourceType && allowed.has(item.sourceId))
    .map((item) => item.sourceId);
}

async function readJsonl(filePath: string): Promise<Record<string, unknown>[]> {
  try {
    return (await readFile(filePath, "utf8"))
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}

function matchesFamily(row: Record<string, unknown>, familyId: string) {
  const stored = readString(row.family_id) || readString(row.family_key);
  return !stored || stored === familyId;
}

function readObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
