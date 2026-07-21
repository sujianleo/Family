import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import type { AssistantRoute, AssistantRouteContract } from "../assistantRouter";

export type AssistantRouteShadowRecord = {
  id: string;
  createdAt: string;
  inputHash: string;
  localRoute: AssistantRoute;
  modelRoute: AssistantRoute | null;
  modelContract: AssistantRouteContract | null;
  confidence: number;
  disagreement: "none" | "action" | "kind" | "model_failed";
  durationMs: number;
  executedRoute: AssistantRoute;
  failureReason?: string;
  initialModelContract?: AssistantRouteContract | null;
  modelName: string;
  promptVersion: string;
  reflectedModelContract?: AssistantRouteContract | null;
  reflectionChanged?: boolean;
  reflectionReason?: string;
  safeForFallbackPromotion: boolean;
  reviewedCorrect?: boolean;
};

const fileName = "assistant-route-shadow.jsonl";
const reviewFileName = "assistant-route-shadow-reviews.jsonl";

export async function appendAssistantRouteShadowRecord(
  input: Omit<AssistantRouteShadowRecord, "createdAt" | "id" | "inputHash"> & { dataDir?: string; inputText: string }
) {
  const dataDir = input.dataDir || "data";
  const record: AssistantRouteShadowRecord = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    inputHash: createHash("sha256").update(input.inputText).digest("hex"),
    localRoute: input.localRoute,
    modelRoute: input.modelRoute,
    modelContract: input.modelContract,
    confidence: input.confidence,
    disagreement: input.disagreement,
    durationMs: input.durationMs,
    executedRoute: input.executedRoute,
    failureReason: input.failureReason,
    initialModelContract: input.initialModelContract,
    modelName: input.modelName,
    promptVersion: input.promptVersion,
    reflectedModelContract: input.reflectedModelContract,
    reflectionChanged: input.reflectionChanged,
    reflectionReason: input.reflectionReason,
    safeForFallbackPromotion: input.safeForFallbackPromotion
  };
  await mkdir(dataDir, { recursive: true });
  await appendFile(`${dataDir}/${fileName}`, `${JSON.stringify(record)}\n`, "utf8");
  await writeAiQualitySummary(dataDir);
  return record;
}

export async function readAssistantRoutePromotionStatus(dataDir = "data") {
  const records = await readRecords(dataDir);
  const firstAt = records[0]?.createdAt ? new Date(records[0].createdAt).getTime() : Date.now();
  const ageDays = (Date.now() - firstAt) / 86_400_000;
  const unsafeCount = records.filter(
    (record) => record.localRoute.kind === "fallback" && record.modelRoute !== null && !record.safeForFallbackPromotion && record.confidence >= 0.65
  ).length;
  const reviewed = records.filter((record) => typeof record.reviewedCorrect === "boolean");
  const overallAccuracy = reviewed.length ? reviewed.filter((record) => record.reviewedCorrect).length / reviewed.length : 0;
  const fallbackRecords = records.filter((record) => record.localRoute.kind === "fallback");
  const fallbackImprovements = fallbackRecords.filter((record) => record.modelRoute && record.modelRoute.kind !== "fallback" && record.confidence >= 0.65).length;
  const fallbackImprovementRate = fallbackRecords.length ? fallbackImprovements / fallbackRecords.length : 0;
  return {
    approved: ageDays >= 7 && records.length >= 100 && reviewed.length >= 30 && unsafeCount === 0 && overallAccuracy >= 0.9 && fallbackImprovementRate >= 0.3,
    ageDays,
    recordCount: records.length,
    unsafeCount,
    reviewedCount: reviewed.length,
    overallAccuracy,
    fallbackImprovementRate
  };
}

export async function appendAssistantRouteShadowReview(recordId: string, correct: boolean, dataDir = "data") {
  await mkdir(dataDir, { recursive: true });
  await appendFile(`${dataDir}/${reviewFileName}`, `${JSON.stringify({ recordId, correct, reviewedAt: new Date().toISOString() })}\n`, "utf8");
  await writeAiQualitySummary(dataDir);
}

export function classifyRouteDisagreement(localRoute: AssistantRoute, modelRoute: AssistantRoute | null) {
  if (!modelRoute) return "model_failed" as const;
  if (localRoute.kind !== modelRoute.kind) return "kind" as const;
  const localId = "id" in localRoute ? localRoute.id : "unit" in localRoute ? localRoute.unit.id : localRoute.reason;
  const modelId = "id" in modelRoute ? modelRoute.id : "unit" in modelRoute ? modelRoute.unit.id : modelRoute.reason;
  return localId === modelId ? ("none" as const) : ("action" as const);
}

async function writeAiQualitySummary(dataDir: string) {
  const records = await readRecords(dataDir);
  const failures = records.filter((record) => record.disagreement === "model_failed");
  const disagreements = records.filter((record) => record.disagreement !== "none" && record.disagreement !== "model_failed");
  const reflections = records.filter((record) => Boolean(record.reflectionReason));
  const changedReflections = reflections.filter((record) => record.reflectionChanged);
  const promotion = await readAssistantRoutePromotionStatus(dataDir);
  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(await readFile(`${dataDir}/ai-quality-summary.json`, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if (!(error instanceof SyntaxError) && !(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const summary = {
    ...current,
    generatedAt: new Date().toISOString(),
    route: {
      total: records.length,
      disagreementRate: records.length ? disagreements.length / records.length : 0,
      modelFailureRate: records.length ? failures.length / records.length : 0,
      reflectionRate: records.length ? reflections.length / records.length : 0,
      reflectionChangeRate: reflections.length ? changedReflections.length / reflections.length : 0,
      averageLatencyMs: records.length ? Math.round(records.reduce((sum, record) => sum + record.durationMs, 0) / records.length) : 0,
      ...promotion
    }
  };
  const target = `${dataDir}/ai-quality-summary.json`;
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

async function readRecords(dataDir: string): Promise<AssistantRouteShadowRecord[]> {
  try {
    const content = await readFile(`${dataDir}/${fileName}`, "utf8");
    const records = content.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line) as AssistantRouteShadowRecord);
    const reviews = await readReviews(dataDir);
    const latestByRecord = new Map(reviews.map((review) => [review.recordId, review.correct]));
    return records.map((record) => (latestByRecord.has(record.id) ? { ...record, reviewedCorrect: latestByRecord.get(record.id) } : record));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

async function readReviews(dataDir: string): Promise<Array<{ recordId: string; correct: boolean }>> {
  try {
    const content = await readFile(`${dataDir}/${reviewFileName}`, "utf8");
    return content.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line) as { recordId: string; correct: boolean });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}
