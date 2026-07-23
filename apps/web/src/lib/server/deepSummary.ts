import type { BaseMessageLike } from "@langchain/core/messages";
import { familyMembers } from "../mockData";
import { deepSummarySchema } from "./ai/schemas/summary.schema";
import { createSummary } from "./eventStore";
import { getDeepModelName, invokeDeepSeekDeepJson } from "./langchainAi";
import { buildSummarySource, type CompactSummaryItem, type SummaryScope, type SummarySourceBundle, type SummaryType } from "./summarySourceBuilder";
import { isLiteBackend } from "./familyBackend";
import { readLiteFamilyMembers } from "./liteRepository";

export const DEEP_SUMMARY_PROMPT_VERSION = "deep-summary-v1";

export type GenerateDeepSummaryInput = {
  actorMemberId?: string | null;
  actorName?: string | null;
  dataDir?: string;
  endTime: string;
  familyId: string;
  scope: SummaryScope;
  startTime: string;
  summaryType: SummaryType;
};

export type DeepSummaryJson = {
  familyInteractions: string[];
  foodAndDailyLife: string[];
  healthSignals: string[];
  importantResources: string[];
  mainEvents: string[];
  memberProfileHints: Array<{
    hints: string[];
    memberName: string;
    sourceIds: string[];
  }>;
  memoryCandidates: Array<{
    confidence: number;
    content: string;
    requiresConfirmation: true;
    sourceIds: string[];
    type: "preference" | "habit" | "family_fact" | "repeated_pattern" | "rule";
  }>;
  moodSignals: string[];
  oneSentenceSummary: string;
  patterns: string[];
  risksOrConcerns: string[];
  sourceIds: string[];
  suggestions: string[];
  summaryTitle: string;
  taskProgress: {
    blocked: string[];
    completed: string[];
    pending: string[];
  };
};

type GenerateDeepSummaryOptions = {
  invokeModel?: (messages: BaseMessageLike[], source: SummarySourceBundle) => Promise<unknown>;
};

export async function generateDeepSummary(input: GenerateDeepSummaryInput, options: GenerateDeepSummaryOptions = {}) {
  const source = await buildSummarySource(input);
  const messages = buildDeepSummaryMessages(input, source);
  let modelResult: unknown;
  if (options.invokeModel) {
    modelResult = await options.invokeModel(messages, source);
  } else {
    const timeoutMs = Number(process.env.DEEPSEEK_DEEP_SUMMARY_TIMEOUT_MS || process.env.DEEPSEEK_TIMEOUT_MS || 30_000);
    try {
      modelResult = await invokeDeepSeekDeepJson(messages, {
        familyId: input.familyId,
        maxTokens: Number(process.env.DEEPSEEK_DEEP_SUMMARY_MAX_TOKENS || 4096),
        operation: `deep_summary.${input.summaryType}`,
        timeoutMs
      });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("JSON")) throw error;
      modelResult = await invokeDeepSeekDeepJson([
        ...messages,
        { role: "system", content: "上一次输出被截断。请显著压缩内容，每个数组最多 4 项，每项最多 40 个汉字，只输出完整合法 JSON。" }
      ], {
        familyId: input.familyId,
        maxTokens: Number(process.env.DEEPSEEK_DEEP_SUMMARY_RETRY_MAX_TOKENS || 6144),
        operation: `deep_summary.${input.summaryType}.retry`,
        timeoutMs: Math.max(timeoutMs, 45_000)
      });
    }
  }

  if (!modelResult) {
    throw new Error("DeepSeek V4 深度总结暂时不可用，请稍后重试。普通输入和快速回复不受影响。");
  }

  const summaryJson = normalizeDeepSummaryJson(modelResult, source.compactItems);
  const modelName = getDeepModelName();
  const summaryRecord = await createSummary({
    actorMemberId: input.scope === "personal" ? input.actorMemberId || null : null,
    dataDir: input.dataDir,
    endTime: input.endTime,
    familyId: input.familyId,
    modelName,
    promptVersion: DEEP_SUMMARY_PROMPT_VERSION,
    scope: input.scope,
    sourceEventIds: idsByType(source.compactItems, "raw_event", summaryJson.sourceIds),
    sourceMessageIds: idsByType(source.compactItems, "message", summaryJson.sourceIds),
    sourceRecordIds: idsByType(source.compactItems, "record", summaryJson.sourceIds),
    sourceResourceIds: idsByType(source.compactItems, "resource", summaryJson.sourceIds),
    sourceTaskIds: idsByType(source.compactItems, "task", summaryJson.sourceIds),
    startTime: input.startTime,
    summaryJson,
    summaryText: summaryJson.oneSentenceSummary,
    summaryType: input.summaryType
  });

  return {
    display: {
      dismissible: true,
      target: "inline_assistant" as const,
      type: "summary_card" as const
    },
    ok: true,
    summary: {
      id: summaryRecord.id,
      modelName,
      promptVersion: DEEP_SUMMARY_PROMPT_VERSION,
      sourceCounts: source.sourceCounts,
      summaryJson
    },
    summaryId: summaryRecord.id
  };
}

function buildDeepSummaryMessages(input: GenerateDeepSummaryInput, source: SummarySourceBundle): BaseMessageLike[] {
  return [
    {
      role: "system",
      content: buildDeepSummaryPrompt(input, source)
    }
  ];
}

function buildDeepSummaryPrompt(input: GenerateDeepSummaryInput, source: SummarySourceBundle) {
  const members = isLiteBackend() ? readLiteFamilyMembers() : familyMembers;
  return `deep-summary-v1
你是家庭生活数据总结器。
你只能基于提供的数据做总结。
你不能编造未出现的事实。
你不能执行动作。
你不能修改数据。
你不能保存记忆。
你只能输出 JSON。

总结对象：
${input.scope === "personal" ? `个人：${input.actorName || input.actorMemberId || "当前成员"}` : "家庭整体"}

时间范围：
${input.startTime} 到 ${input.endTime}

家庭成员：
${members.map((member) => `${member.displayName}(${member.id})`).join("、")}

数据：
${JSON.stringify(source.compactItems)}

请输出合法 JSON，不要输出 markdown。

输出格式：
{
  "summaryTitle": "",
  "oneSentenceSummary": "",
  "mainEvents": [],
  "taskProgress": {
    "completed": [],
    "pending": [],
    "blocked": []
  },
  "familyInteractions": [],
  "moodSignals": [],
  "healthSignals": [],
  "foodAndDailyLife": [],
  "importantResources": [],
  "patterns": [],
  "risksOrConcerns": [],
  "suggestions": [],
  "memoryCandidates": [
    {
      "content": "",
      "type": "preference | habit | family_fact | repeated_pattern | rule",
      "confidence": 0.0,
      "sourceIds": [],
      "requiresConfirmation": true
    }
  ],
  "memberProfileHints": [
    {
      "memberName": "",
      "hints": [],
      "sourceIds": []
    }
  ],
  "sourceIds": []
}

规则：
1. 只能使用提供的数据。
2. 不要编造人物、时间、地点、事件。
3. 不确定的内容要写进 risksOrConcerns 或 suggestions，不要写成事实。
4. memoryCandidates 只能是稳定偏好、习惯、家庭事实或重复模式。
5. 一次性情绪、一次性饮食、临时聊天不要作为长期记忆。
6. 所有 memoryCandidates 必须 requiresConfirmation=true。
7. sourceIds 必须来自输入数据。
8. 建议要短、实际、低压力。
9. 不做医疗、法律、投资确定性判断。
10. 输出必须是合法 JSON。
11. 每个普通数组最多 6 项，每项尽量不超过 60 个汉字。
12. memoryCandidates 最多 4 项，memberProfileHints 每位成员最多 3 条。
13. 总输出保持精炼，必须在一次回复内闭合所有 JSON 字符串、数组和对象。
14. personal 总结要像一张写给这个人的温暖生活小卡片，具体、克制、有温度，不写成数据报表，也不煽情。
15. personal 的 summaryTitle 必须包含该成员称呼；没有足够事实时宁可说得简单，也不能编造。`;
}

function normalizeDeepSummaryJson(value: unknown, sourceItems: CompactSummaryItem[]): DeepSummaryJson {
  const parsed = deepSummarySchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("DeepSeek V4 深度总结返回格式无效，未保存草稿。");
  }
  const objectValue = parsed.data;
  const allowedIds = new Set(sourceItems.map((item) => item.sourceId));
  const sourceIds = readStringArray(objectValue.sourceIds).filter((id) => allowedIds.has(id));
  const fallbackSourceIds = sourceIds.length ? sourceIds : sourceItems.map((item) => item.sourceId);

  return {
    familyInteractions: readStringArray(objectValue.familyInteractions),
    foodAndDailyLife: readStringArray(objectValue.foodAndDailyLife),
    healthSignals: readStringArray(objectValue.healthSignals),
    importantResources: readStringArray(objectValue.importantResources),
    mainEvents: readStringArray(objectValue.mainEvents),
    memberProfileHints: readProfileHints(objectValue.memberProfileHints, allowedIds),
    memoryCandidates: readMemoryCandidates(objectValue.memoryCandidates, allowedIds),
    moodSignals: readStringArray(objectValue.moodSignals),
    oneSentenceSummary: readString(objectValue.oneSentenceSummary) || "没有生成可用总结。",
    patterns: readStringArray(objectValue.patterns),
    risksOrConcerns: readStringArray(objectValue.risksOrConcerns),
    sourceIds: fallbackSourceIds,
    suggestions: readStringArray(objectValue.suggestions),
    summaryTitle: readString(objectValue.summaryTitle) || "家庭总结",
    taskProgress: readTaskProgress(objectValue.taskProgress)
  };
}

function readTaskProgress(value: unknown): DeepSummaryJson["taskProgress"] {
  const objectValue = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    blocked: readStringArray(objectValue.blocked),
    completed: readStringArray(objectValue.completed),
    pending: readStringArray(objectValue.pending)
  };
}

function readMemoryCandidates(value: unknown, allowedIds: Set<string>): DeepSummaryJson["memoryCandidates"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : null))
    .filter(Boolean)
    .map((item) => ({
      confidence: typeof item?.confidence === "number" ? Math.max(0, Math.min(1, item.confidence)) : 0,
      content: readString(item?.content) || "",
      requiresConfirmation: true as const,
      sourceIds: readStringArray(item?.sourceIds).filter((id) => allowedIds.has(id)),
      type: readMemoryType(item?.type)
    }))
    .filter((item) => item.content && item.sourceIds.length);
}

function readProfileHints(value: unknown, allowedIds: Set<string>): DeepSummaryJson["memberProfileHints"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : null))
    .filter(Boolean)
    .map((item) => ({
      hints: readStringArray(item?.hints),
      memberName: readString(item?.memberName) || "",
      sourceIds: readStringArray(item?.sourceIds).filter((id) => allowedIds.has(id))
    }))
    .filter((item) => item.memberName && item.hints.length && item.sourceIds.length);
}

function idsByType(items: CompactSummaryItem[], sourceType: CompactSummaryItem["sourceType"], allowedSourceIds: string[]) {
  const allowed = new Set(allowedSourceIds);
  return items.filter((item) => item.sourceType === sourceType && allowed.has(item.sourceId)).map((item) => item.sourceId);
}

function readMemoryType(value: unknown): DeepSummaryJson["memoryCandidates"][number]["type"] {
  return value === "preference" || value === "habit" || value === "family_fact" || value === "repeated_pattern" || value === "rule" ? value : "family_fact";
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 24) : [];
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}
