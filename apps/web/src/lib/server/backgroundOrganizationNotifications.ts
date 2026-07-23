import { appendFile, mkdir, readFile } from "node:fs/promises";
import { createServiceExternalStoreClient } from "./externalStoreServer";
import { defaultNotificationPreferences, type NotificationPreferences } from "../notifications";
import type { BackgroundOrganizationRecord } from "./backgroundOrganizer";

type Recipient = {
  familyId: string;
  memberId: string;
};

export async function createBackgroundOrganizationNotifications(
  recipients: Recipient[],
  record: BackgroundOrganizationRecord,
  dataDir = "data"
) {
  const externalStore = createServiceExternalStoreClient();
  const createdAt = new Date().toISOString();
  const dayKey =
    (record.organization.dayKey || record.organization.jobKey).split(":").find((part) => /^\d{4}-\d{2}-\d{2}$/.test(part)) ||
    record.createdAt.slice(0, 10);

  for (const recipient of recipients) {
    const preferences = await readDigestNotificationPreferences(recipient, dataDir);
    if (!preferences.inAppEnabled && !preferences.pushEnabled) continue;
    const deliverAfter = applyQuietHours(createdAt, preferences);
    const row = {
      actor_member_id: null,
      body: record.summaryText,
      created_at: createdAt,
      dedupe_key: `background-organization:${recipient.familyId}:${dayKey}:${recipient.memberId}`,
      deep_link: "/organize",
      deliver_after: deliverAfter,
      family_id: recipient.familyId,
      read_at: null,
      recipient_member_id: recipient.memberId,
      scheduled_for: createdAt,
      status: "queued",
      title: "饭米粒整理箱",
      type: "assistant_digest",
      updated_at: createdAt
    };

    if (externalStore && isUuid(recipient.familyId) && isUuid(recipient.memberId)) {
      const { error } = await externalStore.from("notifications").upsert(row, {
        ignoreDuplicates: true,
        onConflict: "dedupe_key"
      });
      if (error) throw error;
      continue;
    }

    await mkdir(dataDir, { recursive: true });
    const localPath = `${dataDir}/notifications.jsonl`;
    if (await containsDedupeKey(localPath, row.dedupe_key)) continue;
    await appendFile(
      localPath,
      `${JSON.stringify({
        actorMemberId: "fanmili",
        body: row.body,
        createdAt,
        dedupeKey: row.dedupe_key,
        deepLink: row.deep_link,
        deliverAfter,
        familyId: recipient.familyId,
        id: crypto.randomUUID(),
        readAt: null,
        recipientMemberId: recipient.memberId,
        scheduledFor: createdAt,
        status: "queued",
        title: row.title,
        type: row.type
      })}\n`,
      "utf8"
    );
  }
}

async function readDigestNotificationPreferences(recipient: Recipient, dataDir: string) {
  const externalStore = createServiceExternalStoreClient();
  if (externalStore && isUuid(recipient.familyId) && isUuid(recipient.memberId)) {
    const { data } = await externalStore
      .from("notification_preferences")
      .select("*")
      .eq("family_id", recipient.familyId)
      .eq("member_id", recipient.memberId)
      .maybeSingle();
    if (data) {
      return {
        chatMessageEnabled: Boolean(data.chat_message_enabled),
        dueReminderEnabled: Boolean(data.due_reminder_enabled),
        inAppEnabled: Boolean(data.in_app_enabled),
        pushEnabled: Boolean(data.push_enabled),
        quietEnd: String(data.quiet_end || "08:00").slice(0, 5),
        quietStart: String(data.quiet_start || "22:00").slice(0, 5),
        reminderOffsets: Array.isArray(data.reminder_offsets) ? data.reminder_offsets.map(Number) : [15, 0],
        taskAssignedEnabled: Boolean(data.task_assigned_enabled),
        timezone: String(data.timezone || "Asia/Shanghai")
      } satisfies NotificationPreferences;
    }
  }
  try {
    const rows = (await readFile(`${dataDir}/notification-preferences.jsonl`, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { memberId?: unknown; preferences?: NotificationPreferences });
    return rows.reverse().find((row) => row.memberId === recipient.memberId)?.preferences || defaultNotificationPreferences;
  } catch {
    return defaultNotificationPreferences;
  }
}

function applyQuietHours(iso: string, preferences: NotificationPreferences) {
  const date = new Date(iso);
  const local = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone: preferences.timezone,
    year: "numeric"
  }).formatToParts(date);
  const get = (type: string) => Number(local.find((part) => part.type === type)?.value || 0);
  const minutes = get("hour") * 60 + get("minute");
  const start = parseMinutes(preferences.quietStart);
  const end = parseMinutes(preferences.quietEnd);
  if (!(minutes >= start || minutes < end)) return iso;
  const delayMinutes = minutes >= start ? 24 * 60 - minutes + end : end - minutes;
  return new Date(date.getTime() + delayMinutes * 60_000).toISOString();
}

function parseMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

async function containsDedupeKey(filePath: string, dedupeKey: string) {
  try {
    return (await readFile(filePath, "utf8"))
      .split("\n")
      .filter(Boolean)
      .some((line) => {
        try {
          return (JSON.parse(line) as { dedupeKey?: unknown }).dedupeKey === dedupeKey;
        } catch {
          return false;
        }
      });
  } catch {
    return false;
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
