import { readFile } from "node:fs/promises";
import { listBackgroundOrganizations } from "./backgroundOrganizer";
import { createServiceSupabaseClient } from "./supabaseServer";
import {
  buildSummarySource,
  isTrustedFamilyEvidenceItem,
  isTrustedFamilyEvidenceRow,
  type CompactSummaryItem
} from "./summarySourceBuilder";

export type TrustedAssistantContext = {
  confirmedMemories: Array<{
    actorMemberId?: string;
    actorName: string;
    createdAt: string;
    eventId: string;
    text: string;
  }>;
  latestOrganization: {
    createdAt: string;
    healthSignals: Array<{
      kind: "duplicate" | "missing_due_time" | "overdue";
      sourceIds: string[];
      text: string;
    }>;
    id: string;
    summaryText: string;
    timeline: Array<{
      actorMemberId?: string;
      actorName: string;
      createdAt: string;
      sourceId: string;
      sourceType: string;
      text: string;
    }>;
  } | null;
  retrievedEvidence: Array<{
    actorMemberId?: string;
    actorName: string;
    createdAt: string;
    sourceId: string;
    sourceType: string;
    text: string;
  }>;
  retrievalPlan: FamilyRetrievalPlan;
  familyLife: {
    recentDays: Array<{
      createdAt: string;
      id: string;
      summaryText: string;
    }>;
    timeline: Array<{
      actorMemberId?: string;
      actorName: string;
      createdAt: string;
      sourceId: string;
      sourceType: string;
      text: string;
    }>;
  };
};

export type FamilyRetrievalSource =
  | "confirmed_memory"
  | "family_records"
  | "group_chat"
  | "resources"
  | "summaries"
  | "tasks"
  | "web";

export type FamilyRetrievalPlan = {
  evidenceSufficient: boolean;
  selectedSources: FamilyRetrievalSource[];
  strategy: "family_global" | "local_specific" | "no_retrieval";
  webPolicy: "explicit_only";
};

type TrustedAssistantContextInput = {
  dataDir: string;
  familyId: string;
  now?: Date;
  query?: string;
};

const organizationMaxAgeMs = 3 * 24 * 60 * 60_000;

export async function prepareTrustedAssistantContext(input: TrustedAssistantContextInput): Promise<TrustedAssistantContext> {
  const now = input.now || new Date();
  const baseRetrievalPlan = selectFamilyRetrievalPlan(input.query || "");
  const [confirmedMemories, organizations, retrievedEvidence] = await Promise.all([
    readConfirmedMemories(input).catch(() => []),
    listBackgroundOrganizations(input.familyId, 7, input.dataDir).catch(() => []),
    retrieveFamilyEvidence(input, now).catch(() => [])
  ]);
  const organization = organizations[0];
  const createdAt = organization?.createdAt || "";
  const organizationIsFresh =
    Boolean(organization) &&
    Number.isFinite(new Date(createdAt).getTime()) &&
    Math.abs(now.getTime() - new Date(createdAt).getTime()) <= organizationMaxAgeMs;
  const recentOrganizations = organizations.filter((item) => {
    const timestamp = new Date(item.createdAt).getTime();
    return Number.isFinite(timestamp) && Math.abs(now.getTime() - timestamp) <= 30 * 24 * 60 * 60_000;
  });

  return {
    confirmedMemories: rankConfirmedMemories(confirmedMemories, input.query || "").slice(0, 8),
    familyLife: {
      recentDays: recentOrganizations.slice(0, 7).map((item) => ({
        createdAt: item.createdAt,
        id: item.id,
        summaryText: item.summaryText.slice(0, 240)
      })),
      timeline: recentOrganizations
        .flatMap((item) => item.organization.timeline)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .slice(-20)
        .map((item) => ({
          actorMemberId: item.actorMemberId,
          actorName: (item.actorName || "").slice(0, 40),
          createdAt: item.createdAt,
          sourceId: item.sourceId,
          sourceType: item.sourceType,
          text: item.text.slice(0, 180)
        }))
    },
    latestOrganization: organization && organizationIsFresh
      ? {
          createdAt,
          healthSignals: organization.organization.healthSignals.slice(0, 4).map((signal) => ({
            kind: signal.kind,
            sourceIds: signal.sourceIds.slice(0, 4),
            text: signal.text.slice(0, 180)
          })),
          id: organization.id,
          summaryText: organization.summaryText.slice(0, 180),
          timeline: organization.organization.timeline.slice(-6).map((item) => ({
            actorMemberId: item.actorMemberId,
            actorName: (item.actorName || "").slice(0, 40),
            createdAt: item.createdAt,
            sourceId: item.sourceId,
            sourceType: item.sourceType,
            text: item.text.slice(0, 180)
          }))
        }
      : null,
    retrievedEvidence,
    retrievalPlan: {
      ...baseRetrievalPlan,
      evidenceSufficient: retrievedEvidence.length > 0
    }
  };
}

export function trustedAssistantContextUsage(context: TrustedAssistantContext) {
  return {
    confirmedMemoryCount: context.confirmedMemories.length,
    healthSignalCount: context.latestOrganization?.healthSignals.length || 0,
    familyLifeDayCount: context.familyLife.recentDays.length,
    familyLifeTimelineCount: context.familyLife.timeline.length,
    retrievedEvidenceCount: context.retrievedEvidence.length,
    retrievalSources: context.retrievalPlan.selectedSources,
    organizationId: context.latestOrganization?.id || null,
    timelineItemCount: context.latestOrganization?.timeline.length || 0
  };
}

async function readConfirmedMemories(input: TrustedAssistantContextInput) {
  const supabase = createServiceSupabaseClient();
  if (supabase && isUuid(input.familyId)) {
    const { data, error } = await supabase
      .from("raw_events")
      .select("id, actor_member_id, actor_name, raw_text, created_at")
      .eq("family_id", input.familyId)
      .eq("source_type", "memory.confirmed")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(80);
    if (!error && Array.isArray(data)) {
      return data.map(toConfirmedMemory).filter(Boolean) as TrustedAssistantContext["confirmedMemories"];
    }
  }

  const rows = await readJsonl(`${input.dataDir}/raw-events.jsonl`);
  return rows
    .filter((row) => row.source_type === "memory.confirmed")
    .filter((row) => isTrustedFamilyEvidenceRow(row, input.familyId))
    .map(toConfirmedMemory)
    .filter((memory): memory is NonNullable<ReturnType<typeof toConfirmedMemory>> => Boolean(memory))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt)) as TrustedAssistantContext["confirmedMemories"];
}

async function retrieveFamilyEvidence(input: TrustedAssistantContextInput, now: Date) {
  const query = (input.query || "").trim();
  if (query.length < 2) return [];
  const plan = selectFamilyRetrievalPlan(query);
  if (plan.strategy === "no_retrieval" || plan.selectedSources.length === 0) return [];
  const source = await buildSummarySource({
    dataDir: input.dataDir,
    endTime: new Date(now.getTime() + 60_000).toISOString(),
    familyId: input.familyId,
    maxItems: 240,
    scope: "family",
    startTime: new Date(now.getTime() - 730 * 86_400_000).toISOString(),
    summaryType: "custom"
  });
  const terms = expandRetrievalTerms(query);
  if (!terms.length) return [];
  return foldRetrievalTaskLifecycle(source.compactItems)
    .filter((item) => isRetrievableEvidence(item) && matchesRetrievalPlan(item, plan))
    .map((item) => ({ item, score: evidenceScore(item, terms, now, plan.strategy === "family_global") }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || right.item.createdAt.localeCompare(left.item.createdAt))
    .slice(0, 12)
    .map(({ item }) => ({
      actorMemberId: item.actorMemberId,
      actorName: (item.actorName || "").slice(0, 40),
      createdAt: item.createdAt,
      sourceId: item.sourceId,
      sourceType: item.sourceType,
      text: item.text.slice(0, 240)
    }));
}

export function selectFamilyRetrievalPlan(query: string): FamilyRetrievalPlan {
  const normalized = query.trim();
  if (!normalized) {
    return {
      evidenceSufficient: false,
      selectedSources: [],
      strategy: "no_retrieval",
      webPolicy: "explicit_only"
    };
  }
  if (/^(?:联网搜索|网络搜索|搜索一下|搜一下|查一下|帮我搜|帮我查|上网查|网上查)/.test(normalized)) {
    return {
      evidenceSufficient: false,
      selectedSources: ["web"],
      strategy: "local_specific",
      webPolicy: "explicit_only"
    };
  }
  if (hasQueryConcept(normalized, ["任务", "待办", "提醒", "完成", "办完", "做完", "搞定", "结束", "负责人", "谁做", "谁负责"])) {
    return plan(["tasks", "group_chat"]);
  }
  if (queryHasRetrievalConcept(normalized, [0, 1, 2, 4, 5, 6])) {
    return plan(["confirmed_memory", "resources", "group_chat"]);
  }
  if (/(?:投票|决定|评评理|约定|规则)/.test(normalized)) {
    return plan(["family_records", "group_chat"]);
  }
  if (/(?:最近|昨天|前天|本周|这个月|总结|回顾|发生了什么|家庭情况)/.test(normalized)) {
    return {
      evidenceSufficient: false,
      selectedSources: ["summaries", "group_chat", "tasks", "resources", "family_records", "confirmed_memory"],
      strategy: "family_global",
      webPolicy: "explicit_only"
    };
  }
  return plan(["confirmed_memory", "group_chat"]);
}

function plan(selectedSources: FamilyRetrievalSource[]): FamilyRetrievalPlan {
  return {
    evidenceSufficient: false,
    selectedSources,
    strategy: "local_specific",
    webPolicy: "explicit_only"
  };
}

function matchesRetrievalPlan(item: CompactSummaryItem, plan: FamilyRetrievalPlan) {
  const eventType = readString(item.metadata?.eventType);
  const rawSourceType = readString(item.metadata?.sourceType);
  return plan.selectedSources.some((source) => {
    if (source === "confirmed_memory") {
      return item.sourceType === "memory" || rawSourceType === "memory.confirmed";
    }
    if (source === "tasks") return item.sourceType === "task";
    if (source === "resources") return item.sourceType === "resource";
    if (source === "family_records") return item.sourceType === "record";
    if (source === "summaries") return item.sourceType === "summary";
    if (source === "group_chat") {
      return item.sourceType === "message" || eventType === "group_chat_message" || rawSourceType === "group_chat";
    }
    return false;
  });
}

function isRetrievableEvidence(item: CompactSummaryItem) {
  return isTrustedFamilyEvidenceItem(item);
}

function evidenceScore(item: CompactSummaryItem, terms: string[], now: Date, allowGlobalFallback = false) {
  const haystack = `${item.actorName || ""}${item.text}`.replace(/\s+/g, "");
  const matches = terms.filter((term) => haystack.includes(term)).length;
  if (!matches && !allowGlobalFallback) return 0;
  const ageDays = Math.max(0, (now.getTime() - new Date(item.createdAt).getTime()) / 86_400_000);
  const rawSourceType = readString(item.metadata?.sourceType);
  const sourceWeight =
    item.sourceType === "memory" || rawSourceType === "memory.confirmed"
      ? 24
      : item.sourceType === "task"
        ? 16
        : item.sourceType === "resource" || item.sourceType === "record"
          ? 12
          : item.sourceType === "summary"
            ? 8
            : 0;
  return matches * 10 + sourceWeight + Math.max(0, 5 - ageDays / 30);
}

function hasQueryConcept(query: string, terms: string[]) {
  return terms.some((term) => query.includes(term));
}

function retrievalTerms(query: string) {
  const compact = query
    .replace(/[，。！？、,.!?\s]/g, "")
    .replace(/(?:请|帮我|告诉我|查一下|找一下|哪里|在哪|是什么|怎么样|怎么了|最近|现在|当前|刚才|前面|记录|总结)/g, "");
  const terms = new Set<string>();
  for (const match of compact.matchAll(/[\u4e00-\u9fff]{2,6}|[a-zA-Z0-9_-]{2,}/g)) {
    const token = match[0];
    terms.add(token);
    for (let index = 0; index < token.length - 1; index += 1) terms.add(token.slice(index, index + 2));
  }
  return [...terms].filter((term) => !["这个", "那个", "一下", "家庭"].includes(term));
}

const familyRetrievalConcepts = [
  ["医保卡", "社保卡", "看病用的卡", "医疗卡", "蓝色卡片", "蓝本本"],
  ["检查报告", "检测报告", "体检报告", "化验单", "检查材料", "就诊材料", "基因检测", "医学遗传", "CNV", "拷贝数变异", "小票", "发票", "票据", "收据", "附件", "上传", "PDF", "图片", "照片", "截图", "图里", "画面"],
  ["钥匙", "门钥匙", "备用钥匙", "开门的钥匙"],
  ["完成", "办完", "做完", "搞定", "结束", "处理完"],
  ["位置", "放哪", "在哪", "哪里", "搁哪", "收哪", "放在", "收在"],
  ["健康", "体检", "血压", "血糖", "血脂", "尿酸", "脂肪肝", "甲状腺", "复查"],
  ["老婆", "媳妇", "媳妇儿", "妻子", "太太", "爱人", "老公", "丈夫", "先生", "配偶", "是谁", "叫啥", "叫什么"]
] as const;

function queryHasRetrievalConcept(query: string, conceptIndexes: number[]) {
  return conceptIndexes.some((index) => familyRetrievalConcepts[index]?.some((alias) => query.includes(alias)));
}

function foldRetrievalTaskLifecycle(items: CompactSummaryItem[]) {
  const latestTaskByRecord = new Map<string, CompactSummaryItem>();
  const otherItems: CompactSummaryItem[] = [];
  for (const item of items.slice().sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
    if (item.sourceType !== "task") {
      otherItems.push(item);
      continue;
    }
    const recordId = readString(item.metadata?.recordId) || item.sourceId;
    latestTaskByRecord.set(recordId, item);
  }
  return [...otherItems, ...latestTaskByRecord.values()];
}

function expandRetrievalTerms(query: string) {
  const terms = new Set(retrievalTerms(query));
  for (const concept of familyRetrievalConcepts) {
    if (!concept.some((alias) => query.includes(alias))) continue;
    for (const alias of concept) {
      terms.add(alias);
      for (const term of retrievalTerms(alias)) terms.add(term);
    }
  }
  return [...terms];
}

function rankConfirmedMemories(
  memories: TrustedAssistantContext["confirmedMemories"],
  query: string
) {
  const terms = expandRetrievalTerms(query);
  if (!terms.length) return memories;
  return memories
    .map((memory) => ({
      memory,
      score: terms.filter((term) => memory.text.includes(term)).length * 10
    }))
    .sort((left, right) => right.score - left.score || right.memory.createdAt.localeCompare(left.memory.createdAt))
    .map(({ memory }) => memory);
}

function toConfirmedMemory(row: Record<string, unknown>) {
  const eventId = readString(row.id);
  const text = readString(row.raw_text).slice(0, 240);
  if (!eventId || !text) return null;
  return {
    actorMemberId: readString(row.actor_member_id) || readString(row.actorMemberId),
    actorName: readString(row.actor_name).slice(0, 40),
    createdAt: readString(row.created_at),
    eventId,
    text
  };
}

async function readJsonl(filePath: string): Promise<Record<string, unknown>[]> {
  try {
    return (await readFile(filePath, "utf8"))
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
