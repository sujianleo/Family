import { mkdir, readFile, writeFile } from "node:fs/promises";

export type SummaryPeriod = "daily" | "weekly" | "monthly";

type MetaSummaryOptions = {
  dataDir?: string;
  now?: Date;
  period: SummaryPeriod;
};

const defaultDataDir = "data";

export async function writeMetaSummary({ dataDir = defaultDataDir, now = new Date(), period }: MetaSummaryOptions) {
  const eventsPath = `${dataDir}/meta-events.jsonl`;
  const summariesPath = `${dataDir}/meta-summaries.jsonl`;
  const range = resolveRange(now, period);
  const events = await readJsonl(eventsPath);
  const summaries = await readJsonl(summariesPath);
  const sourceItems =
    period === "daily"
      ? events.filter((event) => isInRange(new Date(event.created_at), range))
      : summaries.filter((summary) => summary.period === sourcePeriod(period) && rangesOverlap(summary, range));

  if (sourceItems.length === 0) {
    return {
      status: "empty" as const,
      summary: null
    };
  }

  const summary = buildSummary(period, range, sourceItems);
  const existing = summaries.filter((item) => item.id !== summary.id);
  await mkdir(dataDir, { recursive: true });
  await writeFile(summariesPath, `${existing.map((item) => JSON.stringify(item)).join("\n")}${existing.length ? "\n" : ""}${JSON.stringify(summary)}\n`, "utf8");

  return {
    status: "written" as const,
    summary
  };
}

function buildSummary(periodName: SummaryPeriod, rangeValue: { start: string; end: string }, items: any[]) {
  const facts = periodName === "daily" ? summarizeEvents(items) : summarizeSummaries(items, periodName);
  return {
    id: `${periodName}-${rangeValue.start.slice(0, 10)}`,
    period: periodName,
    range_start: rangeValue.start,
    range_end: rangeValue.end,
    source_event_ids: periodName === "daily" ? items.map((item) => item.id) : [],
    source_summary_ids: periodName === "daily" ? [] : items.map((item) => item.id),
    confidence: 0.72,
    summary: facts.join("；") || "没有可压缩的信息。",
    facts,
    created_at: new Date().toISOString()
  };
}

function summarizeEvents(eventsToSummarize: any[]) {
  const byType = countBy(eventsToSummarize, (event) => event.type);
  const facts = [`共记录 ${eventsToSummarize.length} 条事实事件`];
  for (const [type, count] of Object.entries(byType)) {
    facts.push(`${type}: ${count} 条`);
  }

  const importantTexts = eventsToSummarize
    .filter((event) => ["task_created", "task_response", "group_chat_message", "composer_input", "daily_life_log"].includes(event.type) && !isInternalLearningEvent(event))
    .map((event) => compactText(event.text))
    .filter(Boolean)
    .slice(-12);

  if (importantTexts.length) {
    facts.push(`近期内容: ${importantTexts.join(" / ")}`);
  }

  return facts;
}

function summarizeSummaries(sourceSummaries: any[], period: SummaryPeriod) {
  const facts = [`汇总 ${sourceSummaries.length} 份${period === "weekly" ? "每日" : "每周"}压缩上下文`];
  const nestedFacts = sourceSummaries.flatMap((summary) => summary.facts || []).slice(-18);
  return [...facts, ...nestedFacts];
}

async function readJsonl(filePath: string) {
  try {
    const content = await readFile(filePath, "utf8");
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function resolveRange(date: Date, periodName: SummaryPeriod) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);

  if (periodName === "weekly") {
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
  }

  if (periodName === "monthly") {
    start.setDate(1);
  }

  const end = new Date(start);
  if (periodName === "daily") {
    end.setDate(end.getDate() + 1);
  } else if (periodName === "weekly") {
    end.setDate(end.getDate() + 7);
  } else {
    end.setMonth(end.getMonth() + 1);
  }

  return {
    start: start.toISOString(),
    end: end.toISOString()
  };
}

function isInRange(date: Date, rangeValue: { start: string; end: string }) {
  const time = date.getTime();
  return time >= new Date(rangeValue.start).getTime() && time < new Date(rangeValue.end).getTime();
}

function rangesOverlap(summary: any, rangeValue: { start: string; end: string }) {
  return new Date(summary.range_start).getTime() < new Date(rangeValue.end).getTime() && new Date(summary.range_end).getTime() > new Date(rangeValue.start).getTime();
}

function sourcePeriod(periodName: SummaryPeriod) {
  return periodName === "weekly" ? "daily" : "weekly";
}

function countBy(items: any[], getKey: (item: any) => string) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = getKey(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function compactText(text: unknown) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 60);
}

function isInternalLearningEvent(event: any) {
  return event?.metadata?.sessionId === "app-hourly-metadata-learning" || event?.text === "每小时 AI 自动学习整理所有 metadata";
}
