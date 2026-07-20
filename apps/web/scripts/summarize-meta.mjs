import { mkdir, readFile, writeFile } from "node:fs/promises";

const period = readArg("period") || "daily";
const dataDir = new URL("../data/", import.meta.url);
const eventsPath = new URL("meta-events.jsonl", dataDir);
const summariesPath = new URL("meta-summaries.jsonl", dataDir);

const supportedPeriods = new Set(["daily", "weekly", "monthly"]);
if (!supportedPeriods.has(period)) {
  throw new Error(`Unsupported period: ${period}`);
}

const now = new Date();
const range = resolveRange(now, period);
const events = await readJsonl(eventsPath);
const summaries = await readJsonl(summariesPath);
const sourceItems =
  period === "daily"
    ? events.filter((event) => isInRange(new Date(event.created_at), range))
    : summaries.filter((summary) => summary.period === sourcePeriod(period) && rangesOverlap(summary, range));

if (sourceItems.length === 0) {
  console.log(`No ${period} meta data to summarize.`);
  process.exit(0);
}

const summary = buildSummary(period, range, sourceItems);
const existing = summaries.filter((item) => item.id !== summary.id);
await mkdir(dataDir, { recursive: true });
await writeFile(summariesPath, `${existing.map((item) => JSON.stringify(item)).join("\n")}${existing.length ? "\n" : ""}${JSON.stringify(summary)}\n`, "utf8");
console.log(`Wrote ${period} summary: ${summary.id}`);

function buildSummary(periodName, rangeValue, items) {
  const facts = periodName === "daily" ? summarizeEvents(items) : summarizeSummaries(items);
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

function summarizeEvents(eventsToSummarize) {
  const byType = countBy(eventsToSummarize, (event) => event.type);
  const facts = [`共记录 ${eventsToSummarize.length} 条事实事件`];
  for (const [type, count] of Object.entries(byType)) {
    facts.push(`${type}: ${count} 条`);
  }

  const importantTexts = eventsToSummarize
    .filter((event) => ["task_created", "task_response", "group_chat_message", "composer_input"].includes(event.type))
    .map((event) => compactText(event.text))
    .filter(Boolean)
    .slice(-12);

  if (importantTexts.length) {
    facts.push(`近期内容: ${importantTexts.join(" / ")}`);
  }

  return facts;
}

function summarizeSummaries(sourceSummaries) {
  const facts = [`汇总 ${sourceSummaries.length} 份${sourcePeriodLabel(period)}压缩上下文`];
  const nestedFacts = sourceSummaries.flatMap((summary) => summary.facts || []).slice(-18);
  return [...facts, ...nestedFacts];
}

async function readJsonl(url) {
  try {
    const content = await readFile(url, "utf8");
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function resolveRange(date, periodName) {
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

function isInRange(date, rangeValue) {
  const time = date.getTime();
  return time >= new Date(rangeValue.start).getTime() && time < new Date(rangeValue.end).getTime();
}

function rangesOverlap(summary, rangeValue) {
  return new Date(summary.range_start).getTime() < new Date(rangeValue.end).getTime() && new Date(summary.range_end).getTime() > new Date(rangeValue.start).getTime();
}

function sourcePeriod(periodName) {
  return periodName === "weekly" ? "daily" : "weekly";
}

function sourcePeriodLabel(periodName) {
  return periodName === "weekly" ? "每日" : "每周";
}

function countBy(items, getKey) {
  return items.reduce((acc, item) => {
    const key = getKey(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function compactText(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 60);
}

function readArg(name) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}
