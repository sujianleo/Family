import { createServiceSupabaseClient } from "../supabaseServer";
import {
  buildSummarySource,
  type CompactSummaryItem,
  type SummaryScope,
  type SummaryType
} from "../summarySourceBuilder";

export type InsightSourceType =
  | "raw_event"
  | "message"
  | "record"
  | "task"
  | "resource"
  | "summary"
  | "profile"
  | "memory";

export type InsightSourceItem = {
  actor?: {
    id?: string;
    name?: string;
  };
  content: string;
  sourceId: string;
  sourceType: InsightSourceType;
  timestamp: string;
};

export type InsightSourceInput = {
  actorMemberId?: string | null;
  dataDir?: string;
  endTime: string;
  familyId: string;
  maxItems?: number;
  scope: SummaryScope;
  startTime: string;
};

export type InsightSourceBundle = {
  items: InsightSourceItem[];
  range: {
    endTime: string;
    startTime: string;
  };
  scope: SummaryScope;
  sourceCounts: Record<InsightSourceType, number>;
};

const defaultMaxItems = 64;

export async function summarySourceBuilder(input: InsightSourceInput): Promise<InsightSourceBundle> {
  assertSourceInput(input);
  const summaryType = inferSummaryType(input.startTime, input.endTime);
  const summarySource = await buildSummarySource({
    actorMemberId: input.actorMemberId,
    dataDir: input.dataDir,
    endTime: input.endTime,
    familyId: input.familyId,
    maxItems: Math.max(1, Math.min(input.maxItems || defaultMaxItems, 96)),
    scope: input.scope,
    startTime: input.startTime,
    summaryType
  });
  const profileItems = await readProfileSourceItems(input);
  const items = dedupeInsightItems([
    ...summarySource.compactItems.map(toInsightSourceItem),
    ...profileItems
  ]).slice(-(input.maxItems || defaultMaxItems));

  return {
    items,
    range: {
      endTime: input.endTime,
      startTime: input.startTime
    },
    scope: input.scope,
    sourceCounts: countSourceTypes(items)
  };
}

function toInsightSourceItem(item: CompactSummaryItem): InsightSourceItem {
  const sourceType = item.sourceType === "memory" && item.tags?.includes("member_profile")
    ? "profile"
    : item.sourceType;
  const actor = item.actorMemberId || item.actorName
    ? {
        id: item.actorMemberId,
        name: item.actorName
      }
    : undefined;
  return {
    actor,
    content: compactContent(item.text),
    sourceId: item.sourceId,
    sourceType,
    timestamp: item.createdAt
  };
}

async function readProfileSourceItems(input: InsightSourceInput): Promise<InsightSourceItem[]> {
  const supabase = createServiceSupabaseClient();
  if (!supabase || !isUuid(input.familyId)) return [];
  let query = supabase
    .from("family_members")
    .select("id, display_name, profile_json, created_at")
    .eq("family_id", input.familyId)
    .gte("created_at", input.startTime)
    .lt("created_at", input.endTime)
    .order("created_at", { ascending: true })
    .limit(32);
  if (input.scope === "personal" && input.actorMemberId && isUuid(input.actorMemberId)) {
    query = query.eq("id", input.actorMemberId);
  }
  const { data, error } = await query;
  if (error || !Array.isArray(data)) return [];

  return data
    .map((row) => {
      const profile = sanitizeProfile(row.profile_json);
      const content = compactContent(JSON.stringify(profile));
      if (!content || content === "{}") return null;
      return {
        actor: {
          id: String(row.id || ""),
          name: String(row.display_name || "")
        },
        content,
        sourceId: `profile:${String(row.id || "unknown")}`,
        sourceType: "profile" as const,
        timestamp: String(row.created_at || input.startTime)
      };
    })
    .filter(Boolean) as InsightSourceItem[];
}

function sanitizeProfile(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const sensitiveKey = /(?:health|medical|disease|diagnosis|chronic|medication|address|phone|email|identity|resume|careNote)/i;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !sensitiveKey.test(key))
      .map(([key, item]) => [key, sanitizeProfileValue(item)])
      .filter(([, item]) => item !== undefined)
  );
}

function sanitizeProfileValue(value: unknown): string | number | boolean | string[] | undefined {
  if (typeof value === "string") return value.trim().slice(0, 120) || undefined;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const items = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, 12);
    return items.length ? items : undefined;
  }
  return undefined;
}

function countSourceTypes(items: InsightSourceItem[]): Record<InsightSourceType, number> {
  const counts: Record<InsightSourceType, number> = {
    memory: 0,
    message: 0,
    profile: 0,
    raw_event: 0,
    record: 0,
    resource: 0,
    summary: 0,
    task: 0
  };
  for (const item of items) counts[item.sourceType] += 1;
  return counts;
}

function dedupeInsightItems(items: InsightSourceItem[]) {
  const seen = new Set<string>();
  return items
    .filter((item) => item.content && item.sourceId && item.timestamp)
    .filter((item) => {
      const key = `${item.sourceType}:${item.sourceId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

function inferSummaryType(startTime: string, endTime: string): SummaryType {
  const durationMs = new Date(endTime).getTime() - new Date(startTime).getTime();
  if (durationMs <= 36 * 60 * 60_000) return "daily";
  if (durationMs <= 8 * 24 * 60 * 60_000) return "weekly";
  if (durationMs <= 32 * 24 * 60 * 60_000) return "monthly";
  return "custom";
}

function compactContent(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 420);
}

function assertSourceInput(input: InsightSourceInput) {
  const start = new Date(input.startTime).getTime();
  const end = new Date(input.endTime).getTime();
  if (!input.familyId.trim()) throw new Error("familyId is required for insight recall");
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    throw new Error("insight recall requires a valid time range");
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
