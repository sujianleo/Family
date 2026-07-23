import { ChatOpenAI } from "@langchain/openai";
import { DuckDuckGoSearch, SafeSearchType } from "@langchain/community/tools/duckduckgo_search";
import type { BaseMessageLike } from "@langchain/core/messages";
import type { ChatOpenAIResponseFormat } from "@langchain/openai";
import { recordApiUsage } from "./apiUsage";
import { readAiTuningProfileSync } from "./aiTuning";
import { readLiteAiConfig } from "./liteAiConfig";

export type LangChainJsonOptions = {
  apiKey?: string;
  baseUrl?: string;
  dataDir?: string;
  familyId?: string | null;
  maxTokens?: number;
  model?: string;
  operation?: string;
  responseFormat?: ChatOpenAIResponseFormat;
  temperature?: number;
  timeoutMs?: number;
};

export type DuckDuckGoSearchResult = {
  link?: string;
  snippet?: string;
  title?: string;
};

const deepseekBaseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const webSearchTimeoutMs = Number(process.env.WEB_SEARCH_TIMEOUT_MS || 2500);
export function getFastModelName() {
  return process.env.DEEPSEEK_MODEL_FAST || process.env.DEEPSEEK_MODEL || readLiteAiConfig()?.fastModel || "deepseek-v4-flash";
}

export function getDeepModelName() {
  return process.env.DEEPSEEK_MODEL_DEEP || readLiteAiConfig()?.deepModel || "deepseek-v4-pro";
}

export function hasDeepSeekConfiguration() {
  return Boolean(process.env.DEEPSEEK_API_KEY || readLiteAiConfig()?.apiKey);
}

export function createDeepSeekChatModel(options: LangChainJsonOptions = {}) {
  const liteConfig = readLiteAiConfig();
  const apiKey = options.apiKey || liteConfig?.apiKey || process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return null;
  }

  const tuned = readAiTuningProfileSync(options.dataDir || "data", "deepseek");

  return new ChatOpenAI({
    apiKey,
    configuration: {
      baseURL: options.baseUrl || liteConfig?.endpoint || deepseekBaseUrl
    },
    maxRetries: tuned?.maxRetries ?? 1,
    maxTokens: options.maxTokens,
    model: options.model || getFastModelName(),
    temperature: options.temperature ?? tuned?.temperature ?? 0.2,
    timeout: options.timeoutMs ?? tuned?.timeoutMs
  });
}

export function getFastModelClient(options: LangChainJsonOptions = {}) {
  return createDeepSeekChatModel({
    ...options,
    model: options.model || getFastModelName()
  });
}

export function getDeepModelClient(options: LangChainJsonOptions = {}) {
  return createDeepSeekChatModel({
    ...options,
    model: options.model || getDeepModelName(),
    temperature: options.temperature ?? 0.15
  });
}

export async function invokeDeepSeekJson(messages: BaseMessageLike[], options: LangChainJsonOptions = {}) {
  const model = createDeepSeekChatModel(options);
  if (!model) {
    await recordDeepSeekFailure(new Error("DEEPSEEK_API_KEY is not configured"), options, options.model || getFastModelName(), options.operation || "deepseek.json", 0);
    return null;
  }

  const startedAt = Date.now();
  let result: Awaited<ReturnType<typeof model.invoke>>;
  try {
    result = await model.invoke(messages, {
      response_format: options.responseFormat || { type: "json_object" }
    });
  } catch (error) {
    await recordDeepSeekFailure(error, options, options.model || getFastModelName(), options.operation || "deepseek.json", Date.now() - startedAt);
    throw error;
  }
  await recordDeepSeekApiUsage(result, {
    ...options,
    durationMs: Date.now() - startedAt,
    modelName: options.model || getFastModelName(),
    operation: options.operation || "deepseek.json"
  });
  const content = Array.isArray(result.content)
    ? result.content.map((item) => (typeof item === "string" ? item : "text" in item ? item.text : "")).join("")
    : result.content;

  if (typeof content !== "string" || !content.trim()) {
    return null;
  }

  return parseModelJson(content);
}

export async function invokeDeepSeekDeepJson(messages: BaseMessageLike[], options: LangChainJsonOptions = {}) {
  const model = getDeepModelClient(options);
  if (!model) {
    await recordDeepSeekFailure(new Error("DEEPSEEK_API_KEY is not configured"), options, options.model || getDeepModelName(), options.operation || "deepseek.deep_json", 0);
    return null;
  }

  const startedAt = Date.now();
  let result: Awaited<ReturnType<typeof model.invoke>>;
  try {
    result = await model.invoke(messages, {
      response_format: options.responseFormat || { type: "json_object" }
    });
  } catch (error) {
    await recordDeepSeekFailure(error, options, options.model || getDeepModelName(), options.operation || "deepseek.deep_json", Date.now() - startedAt);
    throw error;
  }
  await recordDeepSeekApiUsage(result, {
    ...options,
    durationMs: Date.now() - startedAt,
    modelName: options.model || getDeepModelName(),
    operation: options.operation || "deepseek.deep_json"
  });
  const content = Array.isArray(result.content)
    ? result.content.map((item) => (typeof item === "string" ? item : "text" in item ? item.text : "")).join("")
    : result.content;

  if (typeof content !== "string" || !content.trim()) {
    return null;
  }

  return parseModelJson(content);
}

function parseModelJson(content: string) {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart < 0 || objectEnd <= objectStart) {
    throw new Error("AI 返回的 JSON 不完整，请重试。");
  }
  try {
    return JSON.parse(trimmed.slice(objectStart, objectEnd + 1)) as unknown;
  } catch {
    throw new Error("AI 返回的 JSON 格式不完整，请重试。");
  }
}

export async function invokeDeepSeekText(messages: BaseMessageLike[], options: LangChainJsonOptions = {}) {
  const model = createDeepSeekChatModel(options);
  if (!model) {
    await recordDeepSeekFailure(new Error("DEEPSEEK_API_KEY is not configured"), options, options.model || getFastModelName(), options.operation || "deepseek.text", 0);
    return null;
  }

  const startedAt = Date.now();
  let result: Awaited<ReturnType<typeof model.invoke>>;
  try {
    result = await model.invoke(messages);
  } catch (error) {
    await recordDeepSeekFailure(error, options, options.model || getFastModelName(), options.operation || "deepseek.text", Date.now() - startedAt);
    throw error;
  }
  await recordDeepSeekApiUsage(result, {
    ...options,
    durationMs: Date.now() - startedAt,
    modelName: options.model || getFastModelName(),
    operation: options.operation || "deepseek.text"
  });
  const content = Array.isArray(result.content)
    ? result.content.map((item) => (typeof item === "string" ? item : "text" in item ? item.text : "")).join("")
    : result.content;

  return typeof content === "string" && content.trim() ? content.trim() : null;
}

export async function recordDeepSeekFailure(
  error: unknown,
  options: LangChainJsonOptions,
  modelName: string,
  operation: string,
  durationMs: number
) {
  const errorMessage = error instanceof Error ? error.message : String(error || "Unknown DeepSeek error");
  await recordApiUsage({
    dataDir: options.dataDir,
    durationMs,
    errorMessage,
    familyId: options.familyId || process.env.SUPABASE_DEFAULT_FAMILY_ID || null,
    modelName,
    operation,
    provider: "deepseek",
    status: "failed"
  });
}

export async function recordDeepSeekApiUsage(
  result: unknown,
  options: LangChainJsonOptions & {
    durationMs: number;
    modelName: string;
    operation: string;
  }
) {
  const usage = readDeepSeekUsage(result);
  await recordApiUsage({
    cachedInputTokens: usage.cachedInputTokens,
    completionTokens: usage.completionTokens,
    dataDir: options.dataDir,
    durationMs: options.durationMs,
    familyId: options.familyId || process.env.SUPABASE_DEFAULT_FAMILY_ID || null,
    modelName: options.modelName,
    operation: options.operation,
    promptTokens: usage.promptTokens,
    provider: "deepseek",
    requestId: usage.requestId,
    status: "success",
    totalTokens: usage.totalTokens
  });
}

function readDeepSeekUsage(result: unknown) {
  const resultObject = result && typeof result === "object" && !Array.isArray(result) ? (result as Record<string, unknown>) : {};
  const usageMetadata = readObject(resultObject.usage_metadata);
  const responseMetadata = readObject(resultObject.response_metadata);
  const tokenUsage = readObject(responseMetadata?.tokenUsage) || readObject(responseMetadata?.token_usage) || readObject(responseMetadata?.usage);
  const rawUsage = readObject(resultObject.usage) || usageMetadata || tokenUsage || {};
  const promptTokens = readNumber(rawUsage.prompt_tokens) || readNumber(rawUsage.input_tokens) || readNumber(usageMetadata?.input_tokens);
  const completionTokens = readNumber(rawUsage.completion_tokens) || readNumber(rawUsage.output_tokens) || readNumber(usageMetadata?.output_tokens);
  const totalTokens = readNumber(rawUsage.total_tokens) || readNumber(usageMetadata?.total_tokens) || promptTokens + completionTokens;
  const cachedInputTokens =
    readNumber(rawUsage.prompt_cache_hit_tokens) ||
    readNumber(rawUsage.cache_hit_tokens) ||
    readNumber(rawUsage.cached_tokens) ||
    readNumber(usageMetadata?.input_token_details && readObject(usageMetadata.input_token_details)?.cache_read);
  return {
    cachedInputTokens,
    completionTokens,
    promptTokens,
    requestId: readUsageString(responseMetadata?.id) || readUsageString(responseMetadata?.system_fingerprint),
    totalTokens
  };
}

function readObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readUsageString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function searchDuckDuckGo(query: string, maxResults = 5): Promise<DuckDuckGoSearchResult[]> {
  const tool = new DuckDuckGoSearch({
    maxResults,
    searchOptions: {
      safeSearch: SafeSearchType.MODERATE
    }
  });
  try {
    const raw = await withTimeout(tool.invoke(query), webSearchTimeoutMs);
    const parsed = JSON.parse(raw) as unknown;
    const results = normalizeDuckDuckGoResults(parsed);
    return results.length ? results : searchBingHtml(query, maxResults);
  } catch {
    const results = await searchDuckDuckGoLite(query, maxResults);
    return results.length ? results : searchBingHtml(query, maxResults);
  }
}

async function searchDuckDuckGoLite(query: string, maxResults: number): Promise<DuckDuckGoSearchResult[]> {
  try {
    const params = new URLSearchParams({ q: query });
    const signal = AbortSignal.timeout(webSearchTimeoutMs);
    const response = await fetch(`https://lite.duckduckgo.com/lite/?${params.toString()}`, {
      headers: {
        accept: "text/html",
        "user-agent": "Mozilla/5.0 family-app LangChain DuckDuckGo search"
      },
      signal
    });
    if (!response.ok) {
      return [];
    }
    return parseDuckDuckGoLiteHtml(await response.text()).slice(0, maxResults);
  } catch {
    return [];
  }
}

async function searchBingHtml(query: string, maxResults: number): Promise<DuckDuckGoSearchResult[]> {
  try {
    const params = new URLSearchParams({ q: query });
    const signal = AbortSignal.timeout(webSearchTimeoutMs);
    const response = await fetch(`https://www.bing.com/search?${params.toString()}`, {
      headers: {
        accept: "text/html",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.7",
        "user-agent": "Mozilla/5.0 family-app browser search"
      },
      signal
    });
    if (!response.ok) {
      return [];
    }
    return parseBingHtml(await response.text()).slice(0, maxResults);
  } catch {
    return [];
  }
}

function normalizeDuckDuckGoResults(parsed: unknown): DuckDuckGoSearchResult[] {
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    .map((item) => ({
      link: readString(item.link),
      snippet: readString(item.snippet),
      title: readString(item.title)
    }))
    .filter((item) => item.title || item.link || item.snippet);
}

function parseDuckDuckGoLiteHtml(html: string): DuckDuckGoSearchResult[] {
  const rows = [...html.matchAll(/<a[^>]+class="result-link"[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gis)];
  return rows.map((match) => ({
    link: decodeDuckDuckGoUrl(stripHtml(match[1])),
    title: decodeHtml(stripHtml(match[2]))
  }));
}

function parseBingHtml(html: string): DuckDuckGoSearchResult[] {
  const rows = [
    ...html.matchAll(/<li class="b_algo"[\s\S]*?<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<p[^>]*>([\s\S]*?)<\/p>)?/g)
  ];
  return rows
    .map((match) => ({
      link: decodeHtml(stripHtml(match[1])),
      snippet: decodeHtml(stripHtml(match[3] || "")),
      title: decodeHtml(stripHtml(match[2]))
    }))
    .filter((item) => item.title || item.link);
}

function decodeDuckDuckGoUrl(url: string) {
  const decoded = decodeHtml(url);
  try {
    const parsed = new URL(decoded, "https://duckduckgo.com");
    return parsed.searchParams.get("uddg") || parsed.href;
  } catch {
    return decoded;
  }
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, "").trim();
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("web search timed out")), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
