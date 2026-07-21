import { createServiceSupabaseClient } from "../supabaseServer";
import { runFamilyInsight } from "./insightRunner";
import type { InsightCapability } from "./insightSchema";

type InsightSweepOptions = {
  dataDir?: string;
  force?: boolean;
  now?: Date;
  timeZone?: string;
};

const defaultIntervalMs = 30 * 60_000;
let sweepRunning = false;

declare global {
  var familyAppInsightScheduler: ReturnType<typeof setInterval> | undefined;
  var familyAppInsightInitialTimer: ReturnType<typeof setTimeout> | undefined;
}

export function startInsightScheduler() {
  if (process.env.FAMILY_APP_INSIGHTS_ENABLED === "false") return;
  if (process.env.NODE_ENV === "test" || globalThis.familyAppInsightScheduler) return;
  const run = () => void runInsightSweep().catch((error) => console.error("[family-insight]", error));
  const initialDelayMs = positiveNumber(process.env.FAMILY_APP_INSIGHT_INITIAL_DELAY_MS, 90_000);
  const intervalMs = positiveNumber(process.env.FAMILY_APP_INSIGHT_INTERVAL_MS, defaultIntervalMs);
  globalThis.familyAppInsightInitialTimer = setTimeout(run, initialDelayMs);
  globalThis.familyAppInsightInitialTimer.unref?.();
  globalThis.familyAppInsightScheduler = setInterval(run, intervalMs);
  globalThis.familyAppInsightScheduler.unref?.();
  console.info("[family-insight] derived insight scheduler started");
}

export async function runInsightSweep(options: InsightSweepOptions = {}) {
  if (sweepRunning) return { generated: 0, skipped: 0 };
  sweepRunning = true;
  try {
    const now = options.now || new Date();
    const timeZone = options.timeZone || process.env.FAMILY_APP_TIME_ZONE || "Asia/Shanghai";
    const local = localParts(now, timeZone);
    const scheduledHour = positiveNumber(process.env.FAMILY_APP_INSIGHT_HOUR, 21);
    if (!options.force && local.hour < scheduledHour) return { generated: 0, skipped: 0 };
    const capabilities = dueCapabilities(local, options.force === true);
    const familyIds = await discoverFamilyIds();
    let generated = 0;
    let skipped = 0;
    for (const familyId of familyIds) {
      for (const capability of capabilities) {
        const range = insightRange(capability, now, timeZone);
        try {
          const result = await runFamilyInsight({
            capability,
            dataDir: options.dataDir,
            endTime: now.toISOString(),
            familyId,
            force: options.force,
            periodKey: range.periodKey,
            startTime: range.startTime
          });
          if (result.skipped) skipped += 1;
          else generated += 1;
        } catch (error) {
          skipped += 1;
          console.error(`[family-insight] ${capability} failed`, error);
        }
      }
    }
    return { generated, skipped };
  } finally {
    sweepRunning = false;
  }
}

async function discoverFamilyIds() {
  const supabase = createServiceSupabaseClient();
  if (!supabase) return [process.env.SUPABASE_DEFAULT_FAMILY_ID || "local-family"];
  const { data, error } = await supabase.from("families").select("id").limit(500);
  if (error) throw error;
  return [...new Set((data || []).map((row) => String(row.id || "")).filter(Boolean))];
}

function dueCapabilities(local: ReturnType<typeof localParts>, force: boolean): InsightCapability[] {
  if (force) return ["family.insight.daily", "family.insight.weekly", "family.insight.pattern"];
  const capabilities: InsightCapability[] = ["family.insight.daily"];
  if (local.dayOfWeek === 0) capabilities.push("family.insight.weekly");
  if (local.dayOfWeek === 0 && local.weekOfYear % 2 === 0) capabilities.push("family.insight.pattern");
  return capabilities;
}

export function insightRange(capability: InsightCapability, now: Date, timeZone: string) {
  const dayKey = formatDay(now, timeZone);
  if (capability === "family.insight.daily") {
    return {
      periodKey: dayKey,
      startTime: new Date(now.getTime() - 24 * 60 * 60_000).toISOString()
    };
  }
  if (capability === "family.insight.weekly") {
    return {
      periodKey: `week:${weekKey(now, timeZone)}`,
      startTime: new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString()
    };
  }
  const periodHalf = Number(dayKey.slice(-2)) < 15 ? "1" : "2";
  return {
    periodKey: `pattern:${dayKey.slice(0, 7)}:${periodHalf}`,
    startTime: new Date(now.getTime() - 30 * 24 * 60 * 60_000).toISOString()
  };
}

function localParts(now: Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    hourCycle: "h23",
    month: "numeric",
    timeZone,
    weekday: "short",
    year: "numeric"
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return {
    day: Number(parts.day),
    dayOfWeek: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday),
    hour: Number(parts.hour),
    month: Number(parts.month),
    weekOfYear: weekNumber(now, timeZone),
    year: Number(parts.year)
  };
}

function weekKey(now: Date, timeZone: string) {
  const parts = localParts(now, timeZone);
  return `${parts.year}-W${String(parts.weekOfYear).padStart(2, "0")}`;
}

function weekNumber(now: Date, timeZone: string) {
  const [year, month, day] = formatDay(now, timeZone).split("-").map(Number);
  const current = new Date(Date.UTC(year, month - 1, day));
  const weekday = current.getUTCDay() || 7;
  current.setUTCDate(current.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(current.getUTCFullYear(), 0, 1));
  return Math.ceil((((current.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
}

function formatDay(now: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric"
  }).format(now);
}

function positiveNumber(value: string | undefined, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
