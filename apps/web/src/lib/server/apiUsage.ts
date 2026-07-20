import { appendFile, mkdir, readFile } from "node:fs/promises";
import { createServiceSupabaseClient } from "./supabaseServer";

export type ApiUsageStatus = "success" | "failed";

export type ApiUsageInput = {
  cachedInputTokens?: number;
  completionTokens?: number;
  dataDir?: string;
  durationMs?: number;
  errorMessage?: string | null;
  familyId?: string | null;
  modelName: string;
  operation: string;
  promptTokens?: number;
  provider: "deepseek";
  requestId?: string | null;
  status: ApiUsageStatus;
  totalTokens?: number;
};

export type DeepSeekUsageCostInput = {
  cachedInputTokens?: number;
  completionTokens?: number;
  modelName: string;
  promptTokens?: number;
};

export type ApiUsageRollup = {
  completionTokens: number;
  inputCostCny: number;
  inputCostUsd: number;
  outputCostCny: number;
  outputCostUsd: number;
  promptTokens: number;
  requestCount: number;
  totalCostCny: number;
  totalCostUsd: number;
  totalTokens: number;
};

const defaultDataDir = "data";
export const DEEPSEEK_PRICING_SOURCE_URL = "https://api-docs.deepseek.com/quick_start/pricing";
export const DEEPSEEK_PRICING_RETRIEVED_AT = "2026-07-08";
export const USD_CNY_EXCHANGE_RATE_SOURCE_URL = "https://www.bankofchina.com/sourcedb/whpj/enindex_1619.html";
export const USD_CNY_EXCHANGE_RATE_RETRIEVED_AT = "2026-07-08T16:39:00+08:00";
export const DEFAULT_USD_CNY_RATE = 6.8077;

export const deepSeekPricingByModel = {
  "deepseek-v4-flash": {
    inputCacheHitUsdPer1MTokens: 0.0028,
    inputCacheMissUsdPer1MTokens: 0.14,
    outputUsdPer1MTokens: 0.28
  },
  "deepseek-v4-pro": {
    inputCacheHitUsdPer1MTokens: 0.003625,
    inputCacheMissUsdPer1MTokens: 0.435,
    outputUsdPer1MTokens: 0.87
  }
} as const;

export function calculateDeepSeekUsageCost(input: DeepSeekUsageCostInput) {
  const pricing = readDeepSeekPricing(input.modelName);
  const promptTokens = sanitizeCount(input.promptTokens);
  const cachedInputTokens = Math.min(promptTokens, sanitizeCount(input.cachedInputTokens));
  const cacheMissInputTokens = Math.max(0, promptTokens - cachedInputTokens);
  const completionTokens = sanitizeCount(input.completionTokens);
  const inputCostUsd = roundUsd(
    (cachedInputTokens / 1_000_000) * pricing.inputCacheHitUsdPer1MTokens +
      (cacheMissInputTokens / 1_000_000) * pricing.inputCacheMissUsdPer1MTokens
  );
  const outputCostUsd = roundUsd((completionTokens / 1_000_000) * pricing.outputUsdPer1MTokens);
  const exchangeRate = getUsdCnyRate();
  return {
    cachedInputTokens,
    cacheMissInputTokens,
    completionTokens,
    exchangeRate,
    inputCostCny: roundCny(inputCostUsd * exchangeRate),
    inputCostUsd,
    outputCostCny: roundCny(outputCostUsd * exchangeRate),
    outputCostUsd,
    pricing,
    promptTokens,
    totalCostCny: roundCny((inputCostUsd + outputCostUsd) * exchangeRate),
    totalCostUsd: roundUsd(inputCostUsd + outputCostUsd)
  };
}

export async function recordApiUsage(input: ApiUsageInput) {
  const promptTokens = sanitizeCount(input.promptTokens);
  const completionTokens = sanitizeCount(input.completionTokens);
  const totalTokens = sanitizeCount(input.totalTokens) || promptTokens + completionTokens;
  const cost = calculateDeepSeekUsageCost({
    cachedInputTokens: input.cachedInputTokens,
    completionTokens,
    modelName: input.modelName,
    promptTokens
  });
  const row = {
    id: createUsageId(),
    cached_input_tokens: cost.cachedInputTokens,
    cache_miss_input_tokens: cost.cacheMissInputTokens,
    completion_tokens: completionTokens,
    created_at: new Date().toISOString(),
    duration_ms: sanitizeCount(input.durationMs),
    error_message: input.errorMessage || null,
    exchange_rate_source_url: USD_CNY_EXCHANGE_RATE_SOURCE_URL,
    exchange_rate_retrieved_at: USD_CNY_EXCHANGE_RATE_RETRIEVED_AT,
    family_id: normalizeUuid(input.familyId),
    family_key: input.familyId || null,
    input_cost_cny: cost.inputCostCny,
    input_cost_usd: cost.inputCostUsd,
    model_name: input.modelName,
    operation: input.operation,
    output_cost_cny: cost.outputCostCny,
    output_cost_usd: cost.outputCostUsd,
    pricing_json: cost.pricing,
    pricing_retrieved_at: DEEPSEEK_PRICING_RETRIEVED_AT,
    pricing_source_url: DEEPSEEK_PRICING_SOURCE_URL,
    prompt_tokens: promptTokens,
    provider: input.provider,
    request_id: input.requestId || null,
    status: input.status,
    total_cost_cny: cost.totalCostCny,
    total_cost_usd: cost.totalCostUsd,
    total_tokens: totalTokens
  };

  await insertSupabaseApiUsage(row);
  await appendDebugJsonl(input.dataDir || defaultDataDir, "api-usage.jsonl", row);
  return row;
}

export async function summarizeApiUsage({ dataDir = defaultDataDir }: { dataDir?: string } = {}) {
  const rows = await readJsonl(`${dataDir}/api-usage.jsonl`);
  const initial = emptyRollup();
  const summary = {
    ...initial,
    byModel: {} as Record<string, ApiUsageRollup>,
    byOperation: {} as Record<string, ApiUsageRollup>
  };

  for (const row of rows) {
    addRowToRollup(summary, row);
    const modelName = readString(row.model_name) || "unknown";
    const operation = readString(row.operation) || "unknown";
    summary.byModel[modelName] ||= emptyRollup();
    summary.byOperation[operation] ||= emptyRollup();
    addRowToRollup(summary.byModel[modelName], row);
    addRowToRollup(summary.byOperation[operation], row);
  }

  return summary;
}

function readDeepSeekPricing(modelName: string) {
  if (modelName === "deepseek-v4-pro") {
    return deepSeekPricingByModel["deepseek-v4-pro"];
  }
  return deepSeekPricingByModel["deepseek-v4-flash"];
}

async function insertSupabaseApiUsage(row: Record<string, unknown>) {
  const supabase = createServiceSupabaseClient();
  if (!supabase || !row.family_id) {
    return;
  }
  const { error } = await supabase.from("api_usage").insert(stripUndefined(row));
  if (error) {
    await appendDebugJsonl(defaultDataDir, "event-store-errors.jsonl", {
      created_at: new Date().toISOString(),
      detail: error.message,
      table: "api_usage"
    });
  }
}

async function appendDebugJsonl(dataDir: string, fileName: string, row: Record<string, unknown>) {
  await mkdir(dataDir, { recursive: true });
  await appendFile(`${dataDir}/${fileName}`, `${JSON.stringify(stripUndefined(row))}\n`, "utf8");
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

function addRowToRollup(rollup: ApiUsageRollup, row: Record<string, unknown>) {
  rollup.requestCount += 1;
  rollup.promptTokens += readNumber(row.prompt_tokens);
  rollup.completionTokens += readNumber(row.completion_tokens);
  rollup.totalTokens += readNumber(row.total_tokens);
  rollup.inputCostUsd = roundUsd(rollup.inputCostUsd + readNumber(row.input_cost_usd));
  rollup.outputCostUsd = roundUsd(rollup.outputCostUsd + readNumber(row.output_cost_usd));
  rollup.totalCostUsd = roundUsd(rollup.totalCostUsd + readNumber(row.total_cost_usd));
  rollup.inputCostCny = roundCny(rollup.inputCostCny + readNumber(row.input_cost_cny));
  rollup.outputCostCny = roundCny(rollup.outputCostCny + readNumber(row.output_cost_cny));
  rollup.totalCostCny = roundCny(rollup.totalCostCny + readNumber(row.total_cost_cny));
}

function emptyRollup(): ApiUsageRollup {
  return {
    completionTokens: 0,
    inputCostCny: 0,
    inputCostUsd: 0,
    outputCostCny: 0,
    outputCostUsd: 0,
    promptTokens: 0,
    requestCount: 0,
    totalCostCny: 0,
    totalCostUsd: 0,
    totalTokens: 0
  };
}

function sanitizeCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function roundUsd(value: number) {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}

function roundCny(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function getUsdCnyRate() {
  const configured = Number(process.env.USD_CNY_RATE);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_USD_CNY_RATE;
}

function createUsageId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `usage-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeUuid(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function stripUndefined<T extends Record<string, unknown>>(row: T) {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
}
