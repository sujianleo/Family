import { readFile } from "node:fs/promises";
import { createBackgroundOrganizationNotifications } from "./backgroundOrganizationNotifications";
import {
  listBackgroundOrganizations,
  runBackgroundOrganization,
  type BackgroundOrganizationRecord
} from "./backgroundOrganizer";
import { createServiceExternalStoreClient } from "./externalStoreServer";

type OrganizationTarget = {
  familyId: string;
  recipients: Array<{ familyId: string; memberId: string }>;
};

type SweepOptions = {
  dataDir?: string;
  force?: boolean;
  now?: Date;
  timeZone?: string;
};

const defaultIntervalMs = 15 * 60_000;
const defaultIdleMs = 20 * 60_000;
export const dailyOrganizationHour = 22;
let sweepRunning = false;

declare global {
  var familyAppBackgroundOrganizationScheduler: ReturnType<typeof setInterval> | undefined;
  var familyAppBackgroundOrganizationInitialTimer: ReturnType<typeof setTimeout> | undefined;
}

export function startBackgroundOrganizationScheduler() {
  if (process.env.FAMILY_APP_BACKGROUND_ORGANIZER_ENABLED === "false") return;
  if (process.env.NODE_ENV === "test" || globalThis.familyAppBackgroundOrganizationScheduler) return;

  const run = () =>
    void runBackgroundOrganizationSweep().catch((error) => console.error("[background-organizer]", error));
  const initialDelayMs = positiveNumber(process.env.FAMILY_APP_BACKGROUND_ORGANIZER_INITIAL_DELAY_MS, 60_000);
  const intervalMs = positiveNumber(process.env.FAMILY_APP_BACKGROUND_ORGANIZER_INTERVAL_MS, defaultIntervalMs);
  globalThis.familyAppBackgroundOrganizationInitialTimer = setTimeout(run, initialDelayMs);
  globalThis.familyAppBackgroundOrganizationInitialTimer.unref?.();
  globalThis.familyAppBackgroundOrganizationScheduler = setInterval(run, intervalMs);
  globalThis.familyAppBackgroundOrganizationScheduler.unref?.();
  console.info("[background-organizer] server-side daily organizer started");
}

export async function runBackgroundOrganizationSweep(options: SweepOptions = {}) {
  if (sweepRunning) return { organized: 0, skipped: 0 };
  sweepRunning = true;
  try {
    const now = options.now || new Date();
    const dataDir = options.dataDir || "data";
    const timeZone = options.timeZone || process.env.FAMILY_APP_TIME_ZONE || "Asia/Shanghai";
    const scheduledHour = dailyOrganizationHour;
    const targets = await discoverOrganizationTargets();
    let organized = 0;
    let skipped = 0;
    for (const target of targets) {
      const latestActivityAt = await readLatestActivityAt(target.familyId, dataDir);
      const latestOrganization = (await listBackgroundOrganizations(target.familyId, 1, dataDir))[0];
      const eligibility = evaluateBackgroundOrganizationEligibility({
        force: options.force === true,
        idleMs: positiveNumber(process.env.FAMILY_APP_BACKGROUND_ORGANIZER_IDLE_MS, defaultIdleMs),
        latestActivityAt,
        latestOrganizationAt: latestOrganization?.createdAt,
        now,
        scheduledHour,
        timeZone
      });
      if (!eligibility.eligible) {
        skipped += 1;
        continue;
      }

      const result = await runBackgroundOrganization({
        dataDir,
        endTime: now.toISOString(),
        familyId: target.familyId,
        force: options.force,
        startTime: new Date(now.getTime() - 24 * 60 * 60_000).toISOString(),
        timeZone,
        useAi: process.env.FAMILY_APP_BACKGROUND_AI_ENABLED !== "false"
      });
      if (result.skipped || !result.record) {
        skipped += 1;
        continue;
      }
      await createBackgroundOrganizationNotifications(target.recipients, result.record, dataDir);
      organized += 1;
    }
    return { organized, skipped };
  } finally {
    sweepRunning = false;
  }
}

export function evaluateBackgroundOrganizationEligibility(input: {
  force?: boolean;
  idleMs: number;
  latestActivityAt?: string;
  latestOrganizationAt?: string;
  now: Date;
  scheduledHour: number;
  timeZone: string;
}) {
  if (input.force) return { eligible: true as const, reason: "forced" };
  if (hourInTimeZone(input.now, input.timeZone) < input.scheduledHour) {
    return { eligible: false as const, reason: "before_daily_window" };
  }
  if (!input.latestActivityAt) {
    return { eligible: false as const, reason: "no_activity" };
  }
  const activityTime = new Date(input.latestActivityAt).getTime();
  if (!Number.isFinite(activityTime) || input.now.getTime() - activityTime < input.idleMs) {
    return { eligible: false as const, reason: "family_not_idle" };
  }
  if (input.latestOrganizationAt && input.latestOrganizationAt >= input.latestActivityAt) {
    return { eligible: false as const, reason: "already_up_to_date" };
  }
  if (
    input.latestOrganizationAt &&
    dayInTimeZone(new Date(input.latestOrganizationAt), input.timeZone) === dayInTimeZone(input.now, input.timeZone)
  ) {
    return { eligible: false as const, reason: "daily_limit_reached" };
  }
  return { eligible: true as const, reason: "new_idle_activity" };
}

async function discoverOrganizationTargets(): Promise<OrganizationTarget[]> {
  const externalStore = createServiceExternalStoreClient();
  if (!externalStore) {
    const familyId = "local-family";
    const memberId = "me";
    return [{ familyId, recipients: [{ familyId, memberId }] }];
  }

  const { data, error } = await externalStore
    .from("family_members")
    .select("id, family_id, household_roles, relationship_role");
  if (error) throw error;
  const grouped = new Map<string, OrganizationTarget>();
  for (const row of data || []) {
    const familyId = String(row.family_id || "");
    const memberId = String(row.id || "");
    const roles = Array.isArray(row.household_roles) ? row.household_roles.map(String) : [];
    if (!familyId || !memberId || row.relationship_role === "guest" || roles.includes("assistant")) continue;
    const target = grouped.get(familyId) || { familyId, recipients: [] };
    target.recipients.push({ familyId, memberId });
    grouped.set(familyId, target);
  }
  return [...grouped.values()];
}

async function readLatestActivityAt(familyId: string, dataDir: string) {
  const externalStore = createServiceExternalStoreClient();
  if (externalStore && isUuid(familyId)) {
    const [events, records, messages] = await Promise.all([
      externalStore.from("raw_events").select("created_at").eq("family_id", familyId).order("created_at", { ascending: false }).limit(1),
      externalStore.from("family_records").select("updated_at").eq("family_id", familyId).order("updated_at", { ascending: false }).limit(1),
      externalStore.from("room_messages").select("created_at").eq("family_id", familyId).order("created_at", { ascending: false }).limit(1)
    ]);
    const errors = [events.error, records.error, messages.error].filter(Boolean);
    if (errors.length) throw errors[0];
    return [
      events.data?.[0]?.created_at,
      records.data?.[0]?.updated_at,
      messages.data?.[0]?.created_at
    ]
      .filter((value): value is string => typeof value === "string")
      .sort()
      .at(-1);
  }

  const rows = await Promise.all([
    readJsonl(`${dataDir}/raw-events.jsonl`),
    readJsonl(`${dataDir}/meta-events.jsonl`)
  ]);
  return rows
    .flat()
    .filter((row) => !readString(row.family_id) || readString(row.family_id) === familyId || readString(row.family_key) === familyId)
    .map((row) => readString(row.updated_at) || readString(row.created_at))
    .filter(Boolean)
    .sort()
    .at(-1);
}

function hourInTimeZone(now: Date, timeZone: string) {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      hourCycle: "h23",
      timeZone
    }).format(now)
  );
}

function dayInTimeZone(now: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric"
  }).format(now);
}

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function readJsonl(filePath: string): Promise<Record<string, unknown>[]> {
  try {
    return (await readFile(filePath, "utf8"))
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
