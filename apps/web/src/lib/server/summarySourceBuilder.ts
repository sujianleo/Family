import { readFile } from "node:fs/promises";
import { createServiceExternalStoreClient } from "./externalStoreServer";
import { isLiteBackend } from "./familyBackend";
import { listLiteFamilyRecords } from "./liteRepository";

export type SummaryType = "daily" | "weekly" | "monthly" | "yearly" | "custom";
export type SummaryScope = "personal" | "family";

export type SummarySourceInput = {
  actorMemberId?: string | null;
  dataDir?: string;
  endTime: string;
  familyId: string;
  maxItems?: number;
  scope: SummaryScope;
  startTime: string;
  summaryType: SummaryType;
};

export type CompactSummaryItem = {
  actorMemberId?: string;
  actorName?: string;
  assigneeMemberIds?: string[];
  createdAt: string;
  metadata?: Record<string, unknown>;
  sourceId: string;
  sourceType: "raw_event" | "record" | "message" | "task" | "resource" | "summary" | "memory";
  tags?: string[];
  text: string;
};

export type SummarySourceBundle = {
  compactItems: CompactSummaryItem[];
  range: {
    endTime: string;
    startTime: string;
  };
  scope: SummaryScope;
  sourceCounts: {
    messages: number;
    rawEvents: number;
    records: number;
    resources: number;
    tasks: number;
  };
  summaryType: SummaryType;
};

const defaultDataDir = "data";
const defaultMaxItems = 80;

export async function buildSummarySource(input: SummarySourceInput): Promise<SummarySourceBundle> {
  const dataDir = input.dataDir || defaultDataDir;
  const maxItems = input.maxItems || defaultMaxItems;
  const rawEvents = await readJsonl(`${dataDir}/raw-events.jsonl`);
  const metaEvents = await readJsonl(`${dataDir}/meta-events.jsonl`);
  const memories = await readJsonl(`${dataDir}/memories.jsonl`);
  const summaries = await readJsonl(`${dataDir}/summaries.jsonl`);
  const localDecisions = await readJsonArray(`${dataDir}/family-decisions.json`);
  const localJudgements = await readJsonArray(`${dataDir}/group-judgements.json`);
  const profileItems = await readMemberProfileItems(dataDir, input);
  const externalStoreItems = await readExternalStoreCompactItems(input);
  const liteItems = readLiteCompactItems(input);

  const rawEventItems = rawEvents
    .filter((event) => isEligibleRow(event, input))
    .map((event) => compactRawEvent(event))
    .filter(Boolean) as CompactSummaryItem[];

  const metaItems = metaEvents
    .filter((event) => isEligibleRow(event, input))
    .map((event) => compactMetaEvent(event))
    .filter(Boolean) as CompactSummaryItem[];

  const summaryItems = summaries
    .filter((summary) => isEligibleSummary(summary, input))
    .map((summary) => compactPreviousSummary(summary))
    .filter(Boolean) as CompactSummaryItem[];

  const memoryItems = memories
    .filter((memory) => isEligibleRow(memory, input))
    .map((memory) => compactMemory(memory))
    .filter(Boolean) as CompactSummaryItem[];
  const localDecisionItems = [...localDecisions, ...localJudgements]
    .filter((row) => isEligibleRow(row, input))
    .map((row) => compactFamilyState(row))
    .filter(Boolean) as CompactSummaryItem[];

  const dedupedItems = selectBalancedRecentItems(
    dedupeItems([
      ...externalStoreItems,
      ...liteItems,
      ...rawEventItems,
      ...metaItems,
      ...summaryItems,
      ...memoryItems,
      ...profileItems,
      ...localDecisionItems
    ]).filter(isTrustedFamilyEvidenceItem),
    maxItems
  );

  return {
    compactItems: dedupedItems,
    range: {
      endTime: input.endTime,
      startTime: input.startTime
    },
    scope: input.scope,
    sourceCounts: {
      messages: dedupedItems.filter((item) => item.sourceType === "message").length,
      rawEvents: dedupedItems.filter((item) => item.sourceType === "raw_event").length,
      records: dedupedItems.filter((item) => item.sourceType === "record").length,
      resources: dedupedItems.filter((item) => item.sourceType === "resource").length,
      tasks: dedupedItems.filter((item) => item.sourceType === "task").length
    },
    summaryType: input.summaryType
  };
}

function readLiteCompactItems(input: SummarySourceInput): CompactSummaryItem[] {
  if (!isLiteBackend()) return [];
  return listLiteFamilyRecords(input.familyId, input.maxItems || defaultMaxItems)
    .map((record) => ({
      ...record,
      created_at: record.occurredAt,
      created_by_member_id: record.createdByMemberId,
      family_id: input.familyId,
      metadata: {
        assigneeMemberIds: record.assigneeMemberIds || [],
        audience: record.audience,
        dueAt: record.dueAt,
        status: record.status
      }
    }))
    .filter((row) => isEligibleRecord(row, input))
    .map((row) => compactFamilyRecord(row))
    .filter((item): item is CompactSummaryItem => Boolean(item));
}

async function readExternalStoreCompactItems(input: SummarySourceInput): Promise<CompactSummaryItem[]> {
  const externalStore = createServiceExternalStoreClient();
  if (!externalStore || !isUuid(input.familyId)) {
    return [];
  }

  const rawEvents = await selectRows(
    externalStore
      .from("raw_events")
      .select("id, family_id, actor_member_id, actor_member_key, actor_name, source_type, raw_text, raw_payload_json, server_metadata_json, created_at, deleted_at")
      .eq("family_id", input.familyId)
      .gte("created_at", input.startTime)
      .lt("created_at", input.endTime)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(input.maxItems || defaultMaxItems)
  );

  const records = await selectRows(
    externalStore
      .from("family_records")
      .select("id, family_id, member_id, created_by_member_id, assignee_member_ids, kind, title, summary, status, tags, metadata, created_at, updated_at")
      .eq("family_id", input.familyId)
      .gte("created_at", input.startTime)
      .lt("created_at", input.endTime)
      .order("created_at", { ascending: true })
      .limit(input.maxItems || defaultMaxItems)
  );

  const messages = await selectRows(
    externalStore
      .from("room_messages")
      .select("id, family_id, member_id, body, message_type, metadata, created_at")
      .eq("family_id", input.familyId)
      .gte("created_at", input.startTime)
      .lt("created_at", input.endTime)
      .order("created_at", { ascending: true })
      .limit(input.maxItems || defaultMaxItems)
  );

  const summaries = await selectRows(
    externalStore
      .from("summaries")
      .select("id, family_id, actor_member_id, summary_type, scope, start_time, end_time, summary_text, summary_json, created_at")
      .eq("family_id", input.familyId)
      .lt("start_time", input.endTime)
      .gt("end_time", input.startTime)
      .order("created_at", { ascending: false })
      .limit(12)
  );
  const decisions = await selectRows(
    externalStore
      .from("family_decisions")
      .select("id, family_id, creator_member_id, question, status, closes_at, summary_text, created_at")
      .eq("family_id", input.familyId)
      .gte("created_at", input.startTime)
      .lt("created_at", input.endTime)
      .order("created_at", { ascending: true })
      .limit(input.maxItems || defaultMaxItems)
  );
  const judgements = await selectRows(
    externalStore
      .from("family_judgements")
      .select("id, family_id, creator_member_id, title, statement, status, ends_at, neutral_summary, created_at")
      .eq("family_id", input.familyId)
      .gte("created_at", input.startTime)
      .lt("created_at", input.endTime)
      .order("created_at", { ascending: true })
      .limit(input.maxItems || defaultMaxItems)
  );

  return [
    ...rawEvents.filter((row) => isEligibleRow(row, input)).map((row) => compactRawEvent(row)).filter(Boolean),
    ...records.filter((row) => isEligibleRecord(row, input)).map((row) => compactFamilyRecord(row)).filter(Boolean),
    ...messages.filter((row) => isEligibleMessage(row, input)).map((row) => compactRoomMessage(row)).filter(Boolean),
    ...summaries.filter((row) => isEligibleSummary(row, input)).map((row) => compactPreviousSummary(row)).filter(Boolean),
    ...decisions.filter((row) => isEligibleRow(row, input)).map((row) => compactFamilyState(row)).filter(Boolean),
    ...judgements.filter((row) => isEligibleRow(row, input)).map((row) => compactFamilyState(row)).filter(Boolean)
  ] as CompactSummaryItem[];
}

async function selectRows(query: PromiseLike<{ data: unknown[] | null; error: { message?: string } | null }>) {
  const { data, error } = await query;
  if (error || !Array.isArray(data)) {
    return [];
  }
  return data.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object" && !Array.isArray(row)));
}

async function readJsonl(filePath: string): Promise<Record<string, unknown>[]> {
  try {
    const content = await readFile(filePath, "utf8");
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as unknown)
      .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object" && !Array.isArray(row)));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function readJsonArray(filePath: string): Promise<Record<string, unknown>[]> {
  try {
    const value = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    return Array.isArray(value)
      ? value.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object" && !Array.isArray(row)))
      : [];
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    return [];
  }
}

function isEligibleRow(row: Record<string, unknown>, input: SummarySourceInput) {
  if (!isTrustedFamilyEvidenceRow(row, input.familyId)) {
    return false;
  }
  if (readString(row.deleted_at) || readString(row.archived_at)) {
    return false;
  }

  const createdAt = readString(row.created_at) || readString(row.createdAt) || readString(row.updated_at) || readString(row.updatedAt);
  if (!isInRange(createdAt, input.startTime, input.endTime)) {
    return false;
  }

  if (input.scope === "personal" && input.actorMemberId) {
    const actorKey = readString(row.actor_member_key) || readString(row.actor_member_id) || readString(row.actorMemberId) || readString(row.member_id);
    const assignees = Array.isArray(row.assignee_member_ids) ? row.assignee_member_ids.map(String) : [];
    if (actorKey !== input.actorMemberId && !assignees.includes(input.actorMemberId)) {
      return false;
    }
  }

  return true;
}

function isEligibleSummary(row: Record<string, unknown>, input: SummarySourceInput) {
  if (!isTrustedFamilyEvidenceRow(row, input.familyId)) {
    return false;
  }
  const start = readString(row.start_time) || readString(row.startTime);
  const end = readString(row.end_time) || readString(row.endTime);
  return Boolean(start && end && new Date(start).getTime() < new Date(input.endTime).getTime() && new Date(end).getTime() > new Date(input.startTime).getTime());
}

export function isTrustedFamilyEvidenceRow(row: Record<string, unknown>, familyId: string) {
  const storedFamilyId = readString(row.family_id) || readString(row.familyId) || readString(row.family_key);
  if (storedFamilyId && storedFamilyId !== familyId) return false;
  if (!isSubstantiveConfirmedMemoryRow(row)) return false;
  const metadata = readObject(row.metadata) || readObject(row.server_metadata_json) || readObject(row.raw_payload_json) || {};
  return !hasExcludedEvidenceFlag(row) && !hasExcludedEvidenceFlag(metadata);
}

function isSubstantiveConfirmedMemoryRow(row: Record<string, unknown>) {
  const sourceType = readString(row.source_type) || readString(row.sourceType);
  if (sourceType !== "memory.confirmed") return true;
  const payload = readObject(row.raw_payload_json) || {};
  const candidate = readObject(payload.candidate) || {};
  const rawText = readString(row.raw_text) || "";
  const colonFact = rawText.includes("：") || rawText.includes(":")
    ? rawText.split(/[：:]/).slice(1).join("：").trim()
    : "";
  const fact =
    readString(candidate?.fact) ||
    colonFact ||
    rawText
      .replace(/^(?:请)?(?:帮我)?(?:记一下|记下来|记住|保存一下|保存|记录一下|记录)[，,。.!！?？；;：:\s]*/g, "")
      .trim();
  return fact.length >= 2 && !["记一下", "记住", "保存", "记录一下"].includes(fact);
}

export function isTrustedFamilyEvidenceItem(item: CompactSummaryItem) {
  return !hasExcludedEvidenceFlag(item.metadata || {}) &&
    !/(?:^|[-_])(?:synthetic|seed|fixture|test|smoke)(?:[-_]|$)/i.test(item.sourceId);
}

function hasExcludedEvidenceFlag(value: Record<string, unknown>) {
  return value.synthetic === true ||
    value.testOnly === true ||
    value.excludedFromFamilyMemory === true ||
    value.deleted === true ||
    Boolean(readString(value.deleted_at) || readString(value.archived_at));
}

function selectBalancedRecentItems(items: CompactSummaryItem[], maxItems: number) {
  const buckets = new Map<CompactSummaryItem["sourceType"], CompactSummaryItem[]>();
  for (const item of items) {
    const bucket = buckets.get(item.sourceType) || [];
    bucket.push(item);
    buckets.set(item.sourceType, bucket);
  }
  const sourceOrder: CompactSummaryItem["sourceType"][] = [
    "memory",
    "task",
    "resource",
    "record",
    "summary",
    "message",
    "raw_event"
  ];
  for (const bucket of buckets.values()) {
    bucket.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
  const selected: CompactSummaryItem[] = [];
  for (let depth = 0; selected.length < maxItems; depth += 1) {
    let added = false;
    for (const sourceType of sourceOrder) {
      const item = buckets.get(sourceType)?.[depth];
      if (!item) continue;
      selected.push(item);
      added = true;
      if (selected.length >= maxItems) break;
    }
    if (!added) break;
  }
  return selected.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function isEligibleRecord(row: Record<string, unknown>, input: SummarySourceInput) {
  if (!isEligibleRow(row, input)) {
    return false;
  }
  const status = readString(row.status);
  if (status === "archived" || status === "deleted") {
    return false;
  }
  if (input.scope === "personal" && input.actorMemberId) {
    const createdBy = readString(row.created_by_member_id) || readString(row.createdByMemberId);
    const memberId = readString(row.member_id) || readString(row.memberId);
    const assignees = Array.isArray(row.assignee_member_ids) ? row.assignee_member_ids.map(String) : [];
    return createdBy === input.actorMemberId || memberId === input.actorMemberId || assignees.includes(input.actorMemberId);
  }
  return true;
}

function isEligibleMessage(row: Record<string, unknown>, input: SummarySourceInput) {
  if (!isEligibleRow(row, input)) {
    return false;
  }
  if (input.scope === "personal" && input.actorMemberId) {
    return (readString(row.member_id) || readString(row.memberId)) === input.actorMemberId;
  }
  return true;
}

function compactRawEvent(row: Record<string, unknown>): CompactSummaryItem | null {
  const sourceId = readString(row.id);
  const createdAt = readString(row.created_at) || readString(row.createdAt);
  const text = compactText(row.raw_text || row.text || row.summary);
  if (!sourceId || !createdAt || !text) {
    return null;
  }
  return {
    actorMemberId: readString(row.actor_member_id) || readString(row.actor_member_key) || readString(row.actorMemberId),
    actorName: readString(row.actor_name),
    createdAt,
    metadata: {
      ...(readObject(row.server_metadata_json) || readObject(row.metadata) || {}),
      sourceType: readString(row.source_type) || readString(row.sourceType)
    },
    sourceId,
    sourceType: "raw_event",
    text
  };
}

function compactMetaEvent(row: Record<string, unknown>): CompactSummaryItem | null {
  const sourceId = readString(row.id);
  const createdAt = readString(row.created_at) || readString(row.createdAt);
  const text = compactText(row.text || row.raw_text);
  if (!sourceId || !createdAt || !text) {
    return null;
  }
  const metadata = readObject(row.metadata) || {};
  return {
    actorMemberId: readString(row.actor_member_id) || readString(row.actorMemberId) || readString(metadata.actorMemberId),
    actorName: readString(row.actor_name) || readString(metadata.actorName),
    createdAt,
    metadata: {
      ...metadata,
      eventType: readString(row.type),
      recordId: readString(row.record_id) || readString(metadata.recordId)
    },
    sourceId,
    sourceType: sourceTypeFromMeta(row),
    text
  };
}

function compactFamilyRecord(row: Record<string, unknown>): CompactSummaryItem | null {
  const sourceId = readString(row.id);
  const createdAt = readString(row.created_at) || readString(row.createdAt) || readString(row.updated_at);
  const text = compactText(`${readString(row.title) || ""} ${readString(row.summary) || ""}`);
  if (!sourceId || !createdAt || !text) {
    return null;
  }
  const kind = readString(row.kind);
  const recordMetadata = readObject(row.metadata) || {};
  return {
    actorMemberId: readString(row.created_by_member_id) || readString(row.createdByMemberId) || readString(row.member_id),
    assigneeMemberIds: Array.isArray(row.assignee_member_ids)
      ? row.assignee_member_ids.map(String).filter(Boolean)
      : Array.isArray(recordMetadata.assigneeMemberIds)
        ? recordMetadata.assigneeMemberIds.map(String).filter(Boolean)
        : [],
    createdAt,
    metadata: {
      ...recordMetadata,
      assignmentStatus: readString(row.assignment_status) || readString(recordMetadata.assignmentStatus),
      dueAt: readString(recordMetadata.dueAt) || readString(recordMetadata.due_at),
      status: readString(row.status) || readString(recordMetadata.status),
      updatedAt: readString(row.updated_at) || readString(row.updatedAt)
    },
    sourceId,
    sourceType: kind === "task" ? "task" : kind === "media" || kind === "link" || kind === "note" ? "resource" : "record",
    tags: Array.isArray(row.tags) ? row.tags.map(String).filter(Boolean) : undefined,
    text
  };
}

function compactRoomMessage(row: Record<string, unknown>): CompactSummaryItem | null {
  const sourceId = readString(row.id);
  const createdAt = readString(row.created_at) || readString(row.createdAt);
  const text = compactText(row.body || row.text);
  if (!sourceId || !createdAt || !text) {
    return null;
  }
  return {
    actorMemberId: readString(row.member_id) || readString(row.memberId) || readString(readObject(row.metadata)?.memberId),
    createdAt,
    metadata: readObject(row.metadata),
    sourceId,
    sourceType: "message",
    text
  };
}

function compactPreviousSummary(row: Record<string, unknown>): CompactSummaryItem | null {
  const sourceId = readString(row.id);
  const createdAt = readString(row.created_at) || readString(row.createdAt) || readString(row.end_time);
  const text = compactText(row.summary_text || readObject(row.summary_json)?.oneSentenceSummary);
  if (!sourceId || !createdAt || !text) {
    return null;
  }
  return {
    createdAt,
    sourceId,
    sourceType: "summary",
    text
  };
}

function compactFamilyState(row: Record<string, unknown>): CompactSummaryItem | null {
  const sourceId = readString(row.id);
  const createdAt = readString(row.created_at) || readString(row.createdAt);
  const entityType = readString(row.question) ? "family_decision" : "group_judgement";
  const text = compactText(
    [
      readString(row.question) || readString(row.title),
      readString(row.statement),
      readString(row.summary_text) || readString(row.neutral_summary),
      readString(row.status)
    ].filter(Boolean).join(" ")
  );
  if (!sourceId || !createdAt || !text) return null;
  return {
    actorMemberId: readString(row.creator_member_id) || readString(row.creatorMemberId),
    createdAt,
    metadata: {
      closesAt: readString(row.closes_at) || readString(row.ends_at),
      entityType,
      status: readString(row.status)
    },
    sourceId,
    sourceType: "record",
    tags: [entityType],
    text
  };
}

function compactMemory(row: Record<string, unknown>): CompactSummaryItem | null {
  const sourceId = readString(row.id);
  const createdAt = readString(row.created_at) || readString(row.createdAt) || new Date().toISOString();
  const text = compactText(row.content || row.text || row.summary);
  if (!sourceId || !text) {
    return null;
  }
  return {
    createdAt,
    metadata: readObject(row.metadata),
    sourceId,
    sourceType: "memory",
    tags: readString(row.type) ? [readString(row.type) as string] : undefined,
    text
  };
}

async function readMemberProfileItems(dataDir: string, input: SummarySourceInput): Promise<CompactSummaryItem[]> {
  try {
    const content = await readFile(`${dataDir}/member-profiles.json`, "utf8");
    const parsed = JSON.parse(content) as { generated_at?: string; profiles?: unknown[] };
    const generatedAt = parsed.generated_at || input.endTime;
    if (!Array.isArray(parsed.profiles)) {
      return [];
    }
    return parsed.profiles
      .map((profile) => (profile && typeof profile === "object" && !Array.isArray(profile) ? (profile as Record<string, unknown>) : null))
      .filter(Boolean)
      .map((profile) => {
        const memberId = readString(profile?.memberId) || readString(profile?.member_id);
        if (input.scope === "personal" && input.actorMemberId && memberId !== input.actorMemberId) {
          return null;
        }
        const sourceId = `profile-${memberId || readString(profile?.memberName) || "unknown"}`;
        const text = compactText(JSON.stringify(profile?.profile || {}));
        return text
          ? {
              createdAt: generatedAt,
              metadata: { memberId },
              sourceId,
              sourceType: "memory" as const,
              tags: ["member_profile"],
              text
            }
          : null;
      })
      .filter(Boolean) as CompactSummaryItem[];
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function sourceTypeFromMeta(row: Record<string, unknown>): CompactSummaryItem["sourceType"] {
  const type = readString(row.type);
  if (type?.includes("message") || type?.includes("chat")) {
    return "message";
  }
  if (type?.includes("task")) {
    return "task";
  }
  if (type?.includes("resource") || type?.includes("upload") || type?.includes("attachment")) {
    return "resource";
  }
  return "record";
}

function dedupeItems(items: CompactSummaryItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.sourceType}:${item.sourceId}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function isInRange(value: string | undefined, startTime: string, endTime: string) {
  if (!value) {
    return false;
  }
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time >= new Date(startTime).getTime() && time < new Date(endTime).getTime();
}

function compactText(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 500);
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
