import type { BaseMessageLike } from "@langchain/core/messages";
import { getDeepModel, invokeStructured } from "../ai/models";
import { getDeepModelName } from "../langchainAi";
import { summarySourceBuilder, type InsightSourceBundle } from "./insightBuilder";
import { buildInsightPrompt, INSIGHT_PROMPT_VERSION } from "./insightPrompt";
import {
  insightBatchSchema,
  type InsightBatch,
  type InsightCandidate,
  type InsightCapability
} from "./insightSchema";
import {
  buildSourceFingerprint,
  findCachedInsight,
  storeInsight
} from "./insightService";

export type RunFamilyInsightInput = {
  capability: InsightCapability;
  dataDir?: string;
  endTime: string;
  familyId: string;
  force?: boolean;
  periodKey: string;
  startTime: string;
};

type InsightRunnerDependencies = {
  buildSource?: typeof summarySourceBuilder;
  invokeModel?: (messages: BaseMessageLike[], source: InsightSourceBundle) => Promise<unknown>;
};

export async function runFamilyInsight(
  input: RunFamilyInsightInput,
  dependencies: InsightRunnerDependencies = {}
) {
  const source = await (dependencies.buildSource || summarySourceBuilder)({
    endTime: input.endTime,
    familyId: input.familyId,
    maxItems: maximumItemsForCapability(input.capability),
    scope: "family",
    startTime: input.startTime,
    dataDir: input.dataDir
  });
  if (!source.items.length) {
    return { ok: true as const, reason: "no_source_items" as const, skipped: true as const };
  }

  const sourceIds = source.items.map((item) => item.sourceId);
  const sourceFingerprint = buildSourceFingerprint(sourceIds);
  const identity = {
    capability: input.capability,
    familyId: input.familyId,
    periodKey: input.periodKey,
    promptVersion: INSIGHT_PROMPT_VERSION,
    sourceFingerprint
  };
  if (!input.force) {
    const cached = await findCachedInsight(identity, input.dataDir);
    if (cached) {
      return { cached: true as const, ok: true as const, record: cached, skipped: true as const };
    }
  }

  // Resolve the deep model before building the prompt so production can never silently use Flash.
  if (!dependencies.invokeModel && !getDeepModel({ dataDir: input.dataDir, familyId: input.familyId })) {
    return { ok: false as const, reason: "deep_model_unavailable" as const, skipped: true as const };
  }
  const messages: BaseMessageLike[] = [{ role: "system", content: buildInsightPrompt({ capability: input.capability, source }) }];
  const raw = dependencies.invokeModel
    ? await dependencies.invokeModel(messages, source)
    : await invokeStructured(messages, insightBatchSchema, {
        dataDir: input.dataDir,
        familyId: input.familyId,
        maxTokens: Number(process.env.DEEPSEEK_INSIGHT_MAX_TOKENS || 1200),
        operation: input.capability,
        temperature: 0.1,
        tier: "deep",
        timeoutMs: Number(process.env.DEEPSEEK_INSIGHT_TIMEOUT_MS || process.env.DEEPSEEK_TIMEOUT_MS || 15_000)
      });
  const batch = normalizeModelResult(raw, source);
  if (!batch.insights.length) {
    const record = await storeInsight({
      batch,
      capability: input.capability,
      dataDir: input.dataDir,
      endTime: input.endTime,
      familyId: input.familyId,
      model: getDeepModelName(),
      periodKey: input.periodKey,
      promptVersion: INSIGHT_PROMPT_VERSION,
      source,
      sourceFingerprint,
      startTime: input.startTime
    });
    return {
      ok: true as const,
      presentation: record.presentation,
      record,
      reason: "no_supported_insights" as const,
      skipped: true as const
    };
  }

  const record = await storeInsight({
    batch,
    capability: input.capability,
    dataDir: input.dataDir,
    endTime: input.endTime,
    familyId: input.familyId,
    model: getDeepModelName(),
    periodKey: input.periodKey,
    promptVersion: INSIGHT_PROMPT_VERSION,
    source,
    sourceFingerprint,
    startTime: input.startTime
  });
  return { cached: false as const, ok: true as const, record, skipped: false as const };
}

function normalizeModelResult(value: unknown, source: InsightSourceBundle): InsightBatch {
  const candidate = isStructuredResult(value)
    ? value.ok
      ? value.value
      : null
    : value;
  const parsed = insightBatchSchema.safeParse(candidate);
  if (!parsed.success) return { insights: [] };
  const allowedSourceIds = new Set(source.items.map((item) => item.sourceId));
  const insights = parsed.data.insights
    .map((insight) => normalizeInsight(insight, allowedSourceIds))
    .filter((insight): insight is InsightCandidate => insight !== null)
    .filter((insight) => insight.confidence >= 0.58)
    .slice(0, 6);
  return { insights };
}

function normalizeInsight(insight: InsightCandidate, allowedSourceIds: Set<string>): InsightCandidate | null {
  const sourceIds = [...new Set(insight.sourceIds.filter((sourceId) => allowedSourceIds.has(sourceId)))];
  if (!sourceIds.length || containsUnsafeInference(`${insight.title} ${insight.summary}`)) return null;
  const requiresConfirmation = insight.type === "memory_candidate" || insight.type === "reminder_candidate" || Boolean(insight.suggestedAction)
    ? true
    : insight.requiresConfirmation;
  return {
    ...insight,
    requiresConfirmation,
    sourceIds,
    suggestedAction: insight.suggestedAction
      ? { ...insight.suggestedAction, requiresConfirmation: true }
      : null,
    summary: insight.summary.replace(/\s+/g, " ").trim().slice(0, 180),
    title: insight.title.replace(/\s+/g, " ").trim().slice(0, 48)
  };
}

function containsUnsafeInference(value: string) {
  return /(?:可能|疑似|应该是|一定是).{0,10}(?:患病|生病|抑郁|焦虑|身体不好|关系不好|感情不好|有矛盾)|(?:谁对谁错|不孝|自私|懒惰|有病)/i.test(value);
}

function isStructuredResult(value: unknown): value is { ok: boolean; value?: unknown } {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && "ok" in value);
}

function maximumItemsForCapability(capability: InsightCapability) {
  if (capability === "family.insight.daily") return 48;
  if (capability === "family.insight.weekly") return 72;
  return 96;
}
