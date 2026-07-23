import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AutomationActionId } from "../automationRegistry";
import { zonedDateToUtc } from "../temporal";
import { startBackgroundOrganizationScheduler } from "./backgroundOrganizationScheduler";
import { isLiteBackend } from "./familyBackend";
import { readLiteFamilyMembers } from "./liteRepository";
import { readFamilyMembersWithOverrides } from "./memberOverrides";

export type AssistantScheduledJob = {
  actionId: AutomationActionId;
  actorMemberId: string | null;
  actorName: string | null;
  createdAt: string;
  familyId: string | null;
  id: string;
  parameters: Record<string, unknown>;
  runAt: string;
  status: "pending" | "running" | "completed" | "cancelled" | "failed";
  updatedAt: string;
  error?: string;
};

type JobExecutor = (job: AssistantScheduledJob) => Promise<void>;
export type RecurringExecutor = (actionId: AutomationActionId, parameters: Record<string, unknown>) => Promise<void>;

export const builtInAssistantSchedules = [
  { actionId: "summary.personal.daily" as const, hour: 22, id: "langchain-member-card-daily", perMember: true, period: "daily" as const },
  { actionId: "summary.family.weekly" as const, dayOfWeek: 0, hour: 22, id: "langchain-summary-weekly", period: "weekly" as const },
  { actionId: "summary.family.monthly" as const, dayOfMonth: 1, hour: 0, id: "langchain-summary-monthly", period: "monthly" as const },
  { actionId: "summary.family.yearly" as const, dayOfMonth: 1, hour: 0, id: "langchain-summary-yearly", month: 1, period: "yearly" as const }
];

const schedulerIntervalMs = 15_000;
const scheduledJobFile = "assistant-scheduled-jobs.json";
const schedulableActionIds = new Set<AutomationActionId>([
  "assistant.suggest.next",
  "app.runtime.inspect",
  "member.knowledge.followup",
  "background.organize.daily",
  "meta.summary.daily",
  "meta.summary.weekly",
  "meta.summary.monthly",
  "summary.family.daily",
  "summary.family.weekly",
  "summary.family.monthly",
  "summary.family.yearly",
  "summary.personal.daily"
]);
let dueSweepRunning = false;
let recurringSweepRunning = false;

declare global {
  var familyAppAssistantScheduler: ReturnType<typeof setInterval> | undefined;
}

export function startAssistantScheduler(executeAction?: RecurringExecutor) {
  startBackgroundOrganizationScheduler();
  if (process.env.NODE_ENV === "test" || globalThis.familyAppAssistantScheduler) return;
  if (!executeAction) throw new Error("assistant scheduler requires a whitelisted Action executor");
  const run = () => void Promise.all([
    runDueAssistantJobs({
      execute: async (job) => executeAction(job.actionId, job.parameters)
    }),
    runRecurringAssistantSchedules({ execute: executeAction })
  ]).catch((error) => console.error("[assistant-scheduler]", error));
  run();
  globalThis.familyAppAssistantScheduler = setInterval(run, schedulerIntervalMs);
  globalThis.familyAppAssistantScheduler.unref?.();
  console.info("[assistant-scheduler] AI scheduled-action runner started");
}

export async function scheduleAssistantJob(input: {
  actionId: AutomationActionId;
  actorMemberId?: string;
  actorName?: string;
  dataDir?: string;
  familyId?: string;
  now?: Date;
  parameters?: Record<string, unknown>;
  runAt: string;
}) {
  if (!schedulableActionIds.has(input.actionId)) {
    throw new Error(`动作 ${input.actionId} 不允许由 scheduler 自动执行。`);
  }
  const now = input.now || new Date();
  const runAt = new Date(input.runAt);
  if (!Number.isFinite(runAt.getTime()) || runAt.getTime() <= now.getTime()) {
    throw new Error("scheduler 只接受未来的有效执行时间。");
  }
  const jobs = await readJobs(input.dataDir);
  const timestamp = now.toISOString();
  const job: AssistantScheduledJob = {
    actionId: input.actionId,
    actorMemberId: input.actorMemberId || null,
    actorName: input.actorName || null,
    createdAt: timestamp,
    familyId: input.familyId || null,
    id: randomUUID(),
    parameters: input.parameters || {},
    runAt: runAt.toISOString(),
    status: "pending",
    updatedAt: timestamp
  };
  await writeJobs([...jobs, job], input.dataDir);
  return job;
}

export async function cancelAssistantJob(jobId: string, options: { dataDir?: string; now?: Date } = {}) {
  const jobs = await readJobs(options.dataDir);
  const index = jobs.findIndex((job) => job.id === jobId);
  if (index < 0) throw new Error("没有找到这个 scheduler job。");
  const job = jobs[index];
  if (job.status !== "pending") throw new Error("只有等待中的 scheduler job 可以取消。");
  const next = { ...job, status: "cancelled" as const, updatedAt: (options.now || new Date()).toISOString() };
  jobs[index] = next;
  await writeJobs(jobs, options.dataDir);
  return next;
}

export async function runDueAssistantJobs(options: { dataDir?: string; execute: JobExecutor; now?: Date }) {
  if (dueSweepRunning) return { completed: 0, failed: 0 };
  dueSweepRunning = true;
  try {
    const now = options.now || new Date();
    const jobs = await readJobs(options.dataDir);
    const due = jobs.filter((job) => job.status === "pending" && Date.parse(job.runAt) <= now.getTime());
    let completed = 0;
    let failed = 0;
    for (const job of due) {
      job.status = "running";
      job.updatedAt = now.toISOString();
      await writeJobs(jobs, options.dataDir);
      try {
        await options.execute(job);
        job.status = "completed";
        job.updatedAt = new Date().toISOString();
        delete job.error;
        completed += 1;
      } catch (error) {
        job.status = "failed";
        job.updatedAt = new Date().toISOString();
        job.error = error instanceof Error ? error.message : "scheduled action failed";
        failed += 1;
      }
      await writeJobs(jobs, options.dataDir);
    }
    return { completed, failed };
  } finally {
    dueSweepRunning = false;
  }
}

export async function listAssistantJobs(dataDir?: string) {
  return readJobs(dataDir);
}

export async function runRecurringAssistantSchedules(options: {
  dataDir?: string;
  execute: RecurringExecutor;
  now?: Date;
  timeZone?: string;
}) {
  if (recurringSweepRunning) return { completed: 0, failed: 0 };
  recurringSweepRunning = true;
  try {
    const now = options.now || new Date();
    const timeZone = options.timeZone || process.env.FAMILY_APP_TIME_ZONE || "Asia/Shanghai";
    const local = localScheduleParts(now, timeZone);
    const state = await readScheduleState(options.dataDir);
    let completed = 0;
    let failed = 0;
    for (const schedule of builtInAssistantSchedules) {
      if (local.hour < schedule.hour) continue;
      if (schedule.period === "weekly" && local.dayOfWeek !== schedule.dayOfWeek) continue;
      if (schedule.period === "monthly" && local.dayOfMonth !== schedule.dayOfMonth) continue;
      if (schedule.period === "yearly" && (local.month !== schedule.month || local.dayOfMonth !== schedule.dayOfMonth)) continue;
      const runKey = schedule.period === "yearly"
        ? `${local.year}`
        : schedule.period === "monthly"
          ? `${local.year}-${local.month}`
          : `${local.year}-${local.month}-${local.day}`;
      if ("perMember" in schedule && schedule.perMember) {
        const members = isLiteBackend()
          ? readLiteFamilyMembers()
          : await readFamilyMembersWithOverrides(options.dataDir || "data", now);
        for (const member of members.filter((item) => !item.householdRoles?.includes("assistant"))) {
          const memberStateKey = `${schedule.id}:${member.id}`;
          if (state[memberStateKey] === runKey) continue;
          try {
            await options.execute(schedule.actionId, {
              ...buildRecurringSummaryParameters(schedule.period, now, local, timeZone),
              actor_member_id: member.id,
              actor_name: member.displayName
            });
            completed += 1;
          } catch {
            failed += 1;
          }
          state[memberStateKey] = runKey;
          await writeScheduleState(state, options.dataDir);
        }
        continue;
      }
      if (state[schedule.id] === runKey) continue;
      try {
        await options.execute(schedule.actionId, buildRecurringSummaryParameters(schedule.period, now, local, timeZone));
        state[schedule.id] = runKey;
        await writeScheduleState(state, options.dataDir);
        completed += 1;
      } catch {
        state[schedule.id] = runKey;
        await writeScheduleState(state, options.dataDir);
        failed += 1;
      }
    }
    return { completed, failed };
  } finally {
    recurringSweepRunning = false;
  }
}

function buildRecurringSummaryParameters(
  period: "daily" | "weekly" | "monthly" | "yearly",
  now: Date,
  local: ReturnType<typeof localScheduleParts>,
  timeZone: string
) {
  let start: Date;
  let end = now;
  if (period === "monthly") {
    const currentMonthStart = zonedDateToUtc(local.year, local.month, 1, 0, 0, timeZone);
    const previousMonth = new Date(Date.UTC(local.year, local.month - 2, 1));
    start = zonedDateToUtc(previousMonth.getUTCFullYear(), previousMonth.getUTCMonth() + 1, 1, 0, 0, timeZone);
    end = currentMonthStart;
  } else if (period === "yearly") {
    start = zonedDateToUtc(local.year - 1, 1, 1, 0, 0, timeZone);
    end = zonedDateToUtc(local.year, 1, 1, 0, 0, timeZone);
  } else {
    const localDate = new Date(Date.UTC(local.year, local.month - 1, local.day));
    if (period === "weekly") localDate.setUTCDate(localDate.getUTCDate() - 6);
    start = zonedDateToUtc(localDate.getUTCFullYear(), localDate.getUTCMonth() + 1, localDate.getUTCDate(), 0, 0, timeZone);
  }
  return {
    end_time: end.toISOString(),
    family_id: process.env.FAMILY_APP_LOCAL_AUTH_FAMILY_ID || "local-family",
    now: now.toISOString(),
    start_time: start.toISOString(),
    time_zone: timeZone
  };
}

function resolveJobPath(dataDir?: string) {
  return path.join(dataDir || path.resolve(process.cwd(), "data"), scheduledJobFile);
}

function resolveScheduleStatePath(dataDir?: string) {
  return path.join(dataDir || path.resolve(process.cwd(), "data"), "assistant-recurring-schedule-state.json");
}

function localScheduleParts(date: Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    hourCycle: "h23",
    month: "numeric",
    timeZone,
    weekday: "short",
    year: "numeric"
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return {
    day: Number(parts.day),
    dayOfMonth: Number(parts.day),
    dayOfWeek: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday),
    hour: Number(parts.hour),
    month: Number(parts.month),
    year: Number(parts.year)
  };
}

async function readScheduleState(dataDir?: string): Promise<Record<string, string>> {
  try {
    const value = JSON.parse(await readFile(resolveScheduleStatePath(dataDir), "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
    throw error;
  }
}

async function writeScheduleState(state: Record<string, string>, dataDir?: string) {
  const filePath = resolveScheduleStatePath(dataDir);
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

async function readJobs(dataDir?: string): Promise<AssistantScheduledJob[]> {
  try {
    const value = JSON.parse(await readFile(resolveJobPath(dataDir), "utf8"));
    return Array.isArray(value) ? value : [];
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeJobs(jobs: AssistantScheduledJob[], dataDir?: string) {
  const filePath = resolveJobPath(dataDir);
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(jobs, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}
