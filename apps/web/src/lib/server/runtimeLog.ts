import { appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type RuntimeEventLevel = "info" | "warn" | "error";
export type RuntimeEventStatus = "started" | "success" | "failed" | "skipped";
export type RuntimeErrorType =
  | "authentication"
  | "invalid_response"
  | "network"
  | "push"
  | "rate_limited"
  | "storage"
  | "timeout"
  | "unknown";

export type RuntimeLogQuery = {
  component?: string;
  errorType?: RuntimeErrorType;
  hours?: number;
  level?: RuntimeEventLevel;
  limit?: number;
};

export type RuntimeLogSummary = {
  ai: RuntimeOperationSummary;
  automation: RuntimeOperationSummary;
  counts: Record<RuntimeEventLevel, number>;
  generatedAt: string;
  hours: number;
  matchedEvents: number;
  recentIssues: RuntimeIssueSummary[];
  status: "healthy" | "degraded" | "attention" | "unknown";
};

type RuntimeOperationSummary = {
  averageDurationMs: number;
  failed: number;
  success: number;
};

type RuntimeIssueSummary = {
  createdAt: string;
  errorType: RuntimeErrorType;
  event: string;
  source: string;
};

type RuntimeEventRow = {
  created_at: string;
  duration_ms: number | null;
  error_type: RuntimeErrorType | null;
  event: string;
  id: string;
  level: RuntimeEventLevel;
  metadata: Record<string, boolean | number | string>;
  source: string;
  status: RuntimeEventStatus | null;
};

const defaultDataDir = "data";
const logFileName = "runtime-events.jsonl";
const maxLogBytes = 2 * 1024 * 1024;
const retainedLogLines = 1_500;
const safeMetadataKeys = new Set([
  "actionId",
  "attempted",
  "completionTokens",
  "component",
  "modelName",
  "nodeEnv",
  "operation",
  "pipelineId",
  "promptTokens",
  "resultStatus",
  "routeId",
  "routeKind",
  "sideEffectLevel",
  "sent",
  "stepCount",
  "totalTokens"
]);
let writeQueue: Promise<void> = Promise.resolve();

export function recordRuntimeEvent(input: {
  dataDir?: string;
  durationMs?: number;
  error?: unknown;
  event: string;
  level?: RuntimeEventLevel;
  metadata?: Record<string, unknown>;
  source: string;
  status?: RuntimeEventStatus;
}) {
  const row: RuntimeEventRow = {
    created_at: new Date().toISOString(),
    duration_ms: sanitizeDuration(input.durationMs),
    error_type: input.error === undefined ? null : classifyRuntimeError(input.error),
    event: sanitizeIdentifier(input.event),
    id: randomUUID(),
    level: input.level || (input.status === "failed" ? "error" : "info"),
    metadata: sanitizeMetadata(input.metadata),
    source: sanitizeIdentifier(input.source),
    status: input.status || null
  };
  const filePath = resolveLogPath(input.dataDir);
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      await mkdir(path.dirname(filePath), { recursive: true });
      await appendFile(filePath, `${JSON.stringify(row)}\n`, "utf8");
      await rotateLogIfNeeded(filePath);
    })
    .catch((error) => {
      console.error("[runtime-log] write failed", error instanceof Error ? error.name : "unknown");
    });
  return writeQueue;
}

export async function summarizeRuntimeStatus(
  query: RuntimeLogQuery & { dataDir?: string } = {}
): Promise<RuntimeLogSummary> {
  await writeQueue.catch(() => undefined);
  const hours = clampInteger(query.hours, 24, 1, 24 * 30);
  const limit = clampInteger(query.limit, 8, 1, 20);
  const cutoff = Date.now() - hours * 60 * 60 * 1_000;
  const component = normalizeComponent(query.component);
  const rows = (await readRuntimeRows(resolveLogPath(query.dataDir)))
    .filter((row) => Date.parse(row.created_at) >= cutoff)
    .filter((row) => !component || row.source === component || row.source.startsWith(`${component}.`))
    .filter((row) => !query.level || row.level === query.level)
    .filter((row) => !query.errorType || row.error_type === query.errorType);
  const counts = rows.reduce(
    (result, row) => ({ ...result, [row.level]: result[row.level] + 1 }),
    { error: 0, info: 0, warn: 0 } as Record<RuntimeEventLevel, number>
  );
  const recentIssues = rows
    .filter((row) => row.level === "error" || row.status === "failed")
    .slice(-limit)
    .reverse()
    .map((row) => ({
      createdAt: row.created_at,
      errorType: row.error_type || "unknown",
      event: row.event,
      source: row.source
    }));
  const recentError = recentIssues.some((issue) => Date.parse(issue.createdAt) >= Date.now() - 15 * 60 * 1_000);
  return {
    ai: summarizeOperations(rows.filter((row) => row.source.startsWith("ai."))),
    automation: summarizeOperations(rows.filter((row) => row.source.startsWith("automation."))),
    counts,
    generatedAt: new Date().toISOString(),
    hours,
    matchedEvents: rows.length,
    recentIssues,
    status:
      rows.length === 0
        ? "unknown"
        : recentError || recentIssues.length >= 3
          ? "attention"
          : recentIssues.length > 0
            ? "degraded"
            : "healthy"
  };
}

export function formatRuntimeStatusAnswer(summary: RuntimeLogSummary, query: RuntimeLogQuery = {}) {
  if (summary.matchedEvents === 0) {
    return `最近 ${summary.hours} 小时没有匹配到运行事件。可以扩大时间范围，或取消模块/级别筛选。运行日志只保存脱敏的结构化状态，不保存聊天正文和密钥。`;
  }
  const statusLabel = summary.status === "healthy" ? "正常" : summary.status === "degraded" ? "有少量异常" : "需要关注";
  const filters = [query.component ? `模块 ${query.component}` : "全部模块", query.level ? `${query.level} 级别` : "全部级别"];
  const issueText = summary.recentIssues.length
    ? `最近问题：${summary.recentIssues
        .slice(0, 5)
        .map((issue) => `${formatRuntimeTime(issue.createdAt)} ${issue.source}/${issue.event}（${runtimeErrorLabel(issue.errorType)}）`)
        .join("；")}。`
    : "没有发现失败事件。";
  return [
    `App 运行状态：${statusLabel}。统计范围为最近 ${summary.hours} 小时，${filters.join("、")}，共 ${summary.matchedEvents} 条脱敏事件。`,
    `级别：错误 ${summary.counts.error}、警告 ${summary.counts.warn}、信息 ${summary.counts.info}。`,
    `AI：成功 ${summary.ai.success}、失败 ${summary.ai.failed}、平均耗时 ${summary.ai.averageDurationMs}ms；Action：成功 ${summary.automation.success}、失败 ${summary.automation.failed}、平均耗时 ${summary.automation.averageDurationMs}ms。`,
    issueText,
    "日志读取已按时间、模块和错误类别缩小范围，不会把整份日志或聊天正文交给 AI。"
  ].join("\n")
}

export function classifyRuntimeError(error: unknown): RuntimeErrorType {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error || "");
  if (/timeout|timed out|abort|超时/i.test(text)) return "timeout";
  if (/429|rate.?limit|too many requests|限流/i.test(text)) return "rate_limited";
  if (/401|403|unauthor|forbidden|auth|认证|鉴权/i.test(text)) return "authentication";
  if (/json|parse|schema|invalid response|格式|解析/i.test(text)) return "invalid_response";
  if (/push|vapid|notification|通知/i.test(text)) return "push";
  if (/database|supabase|storage|disk|write|read|数据库|存储/i.test(text)) return "storage";
  if (/network|fetch|socket|connect|econn|dns|网络|连接/i.test(text)) return "network";
  return "unknown";
}

function resolveLogPath(dataDir = defaultDataDir) {
  return path.join(dataDir, logFileName);
}

async function rotateLogIfNeeded(filePath: string) {
  const details = await stat(filePath);
  if (details.size <= maxLogBytes) return;
  const lines = (await readFile(filePath, "utf8")).split("\n").filter(Boolean).slice(-retainedLogLines);
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${lines.join("\n")}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

async function readRuntimeRows(filePath: string): Promise<RuntimeEventRow[]> {
  try {
    const lines = (await readFile(filePath, "utf8")).split("\n").filter(Boolean).slice(-2_000);
    return lines.flatMap((line) => {
      try {
        const row = JSON.parse(line) as Partial<RuntimeEventRow>;
        if (!row.created_at || !row.event || !row.source || !row.level) return [];
        return [row as RuntimeEventRow];
      } catch {
        return [];
      }
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

function summarizeOperations(rows: RuntimeEventRow[]): RuntimeOperationSummary {
  const completed = rows.filter((row) => row.status === "success" || row.status === "failed");
  const durations = completed.map((row) => row.duration_ms).filter((value): value is number => typeof value === "number");
  return {
    averageDurationMs: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0,
    failed: completed.filter((row) => row.status === "failed").length,
    success: completed.filter((row) => row.status === "success").length
  };
}

function sanitizeMetadata(metadata: Record<string, unknown> | undefined) {
  if (!metadata) return {};
  const result: Record<string, boolean | number | string> = {};
  for (const [key, value] of Object.entries(metadata).filter(([key]) => safeMetadataKeys.has(key)).slice(0, 16)) {
    if (typeof value === "boolean") result[key] = value;
    if (typeof value === "number" && Number.isFinite(value)) result[key] = Math.round(value);
    if (typeof value === "string") result[key] = sanitizeIdentifier(value);
  }
  return result;
}

function sanitizeIdentifier(value: string) {
  return value.replace(/[^a-z0-9_.:-]/gi, "_").slice(0, 80) || "unknown";
}

function sanitizeDuration(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;
}

function normalizeComponent(value: string | undefined) {
  return value ? sanitizeIdentifier(value.trim().toLowerCase()) : "";
}

function clampInteger(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function formatRuntimeTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    timeZone: process.env.FAMILY_APP_TIME_ZONE || "Asia/Shanghai"
  }).format(new Date(value));
}

function runtimeErrorLabel(value: RuntimeErrorType) {
  const labels: Record<RuntimeErrorType, string> = {
    authentication: "认证失败",
    invalid_response: "响应格式异常",
    network: "网络异常",
    push: "通知异常",
    rate_limited: "接口限流",
    storage: "存储异常",
    timeout: "请求超时",
    unknown: "未分类异常"
  };
  return labels[value];
}
