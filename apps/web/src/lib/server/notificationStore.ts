import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { defaultNotificationPreferences, type FamilyNotification, type NotificationPlatform, type NotificationPreferences, type NotificationType } from "../notifications";
import { buildTaskReminderNotificationCopy } from "../taskNotificationCopy";
import type { DecisionNotificationEvent } from "../familyDecisions";

type Context = { familyId: string; memberId: string };
type NotificationRow = FamilyNotification & { familyId: string; recipientMemberId: string; status: string; dedupeKey: string; deliverAfter: string };
type RecordNotificationInput = { id?: string; title: string; kind: string; status: string; assigneeMemberIds: string[]; chatMembers: string[]; chatMessages: Array<{ id: string; body: string; senderMemberId?: string; senderName?: string }>; dueAt?: string; reminderOffsets?: number[] };
export type PendingNotificationEvent = { recipientMemberId: string; type: NotificationType; title: string; body: string; scheduledFor: string; dedupeKey: string };
const dataDir = "data";

export async function listNotifications(context: Context, limit = 50) {
  const now = new Date().toISOString();
  const rows = (await readJsonl<NotificationRow>(`${dataDir}/notifications.jsonl`)).filter((row) => (row.recipientMemberId === context.memberId || !context.memberId) && isNotificationVisible(row, now));
  const latest = [...new Map(rows.map((row) => [row.dedupeKey || row.id, row])).values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  return { notifications: latest, unreadCount: latest.filter((item) => !item.readAt && item.status !== "canceled").length };
}

export async function markNotificationsRead(context: Context, input: { id?: string; all?: boolean }) {
  const now = new Date().toISOString();
  const rows = await readJsonl<NotificationRow>(`${dataDir}/notifications.jsonl`);
  await writeJsonl(`${dataDir}/notifications.jsonl`, rows.map((row) => row.recipientMemberId === context.memberId && (input.all || row.id === input.id) ? { ...row, readAt: now } : row));
}

export async function clearNotifications(context: Context) {
  const now = new Date().toISOString();
  const rows = await readJsonl<NotificationRow>(`${dataDir}/notifications.jsonl`);
  await writeJsonl(`${dataDir}/notifications.jsonl`, rows.map((row) => row.recipientMemberId === context.memberId ? { ...row, status: "canceled" } : row));
}

export async function readNotificationPreferences(context: Context): Promise<NotificationPreferences> {
  const rows = await readJsonl<{ memberId: string; preferences: NotificationPreferences }>(`${dataDir}/notification-preferences.jsonl`);
  return rows.reverse().find((row) => row.memberId === context.memberId)?.preferences || defaultNotificationPreferences;
}

export async function writeNotificationPreferences(context: Context, preferences: NotificationPreferences) {
  await appendJsonl("notification-preferences.jsonl", { memberId: context.memberId, preferences });
}

export async function registerNotificationEndpoint(context: Context, input: { deviceId: string; platform: NotificationPlatform; endpoint: string; p256dh: string; auth: string }) {
  await appendJsonl("notification-endpoints.jsonl", { ...input, memberId: context.memberId, channel: "web_push", active: true, updatedAt: new Date().toISOString() });
}

export async function unregisterNotificationEndpoint(context: Context, deviceId: string) {
  await appendJsonl("notification-endpoints.jsonl", {
    active: false,
    deviceId,
    memberId: context.memberId,
    updatedAt: new Date().toISOString()
  });
}

export async function createRecordNotifications(context: Context, record: RecordNotificationInput) {
  if (record.id && record.status === "done") {
    await cancelTaskNotifications(context, record.id);
    return 0;
  }
  const dueAt = record.dueAt ? new Date(record.dueAt) : null;
  if (dueAt && !Number.isNaN(dueAt.getTime()) && record.id) await cancelDueNotifications(context, record.id);
  const events = buildRecordNotificationEvents(context, record);
  await persistNotificationEvents(context, record.id || "", events);
  return events.length;
}

export async function createDecisionNotifications(context: Context, decisionId: string, events: DecisionNotificationEvent[]) {
  await persistNotificationEvents(context, "", events, `/?decision=${encodeURIComponent(decisionId)}`);
  return events.length;
}

export function buildRecordNotificationEvents(context: Context, record: RecordNotificationInput, now = new Date()): PendingNotificationEvent[] {
  if (record.status === "done") return [];
  const events: PendingNotificationEvent[] = [];
  for (const memberId of record.assigneeMemberIds.filter((id) => id && id !== context.memberId)) {
    events.push({ recipientMemberId: memberId, type: "task_assigned", title: "新任务", body: record.title, scheduledFor: now.toISOString(), dedupeKey: `task:${record.id}:assigned:${memberId}` });
  }
  const message = record.chatMessages.at(-1);
  if (message) {
    for (const memberId of record.chatMembers.filter((id) => id && id !== (message.senderMemberId || context.memberId))) {
      events.push({ recipientMemberId: memberId, type: "chat_message", title: record.title, body: `${message.senderName || "家人"}：${message.body}`.slice(0, 160), scheduledFor: now.toISOString(), dedupeKey: `chat:${record.id}:${message.id}:${memberId}` });
    }
  }
  const dueAt = record.dueAt ? new Date(record.dueAt) : null;
  if (dueAt && !Number.isNaN(dueAt.getTime()) && record.status !== "done") {
    for (const memberId of record.assigneeMemberIds.length ? record.assigneeMemberIds : [context.memberId]) {
      for (const offset of record.reminderOffsets?.length ? record.reminderOffsets : [15, 0]) {
        const scheduledFor = new Date(dueAt.getTime() - offset * 60_000);
        if (scheduledFor.getTime() < now.getTime()) continue;
        const copy = buildTaskReminderNotificationCopy(record.title, offset);
        events.push({ recipientMemberId: memberId, type: "task_due", title: copy.title, body: copy.body, scheduledFor: scheduledFor.toISOString(), dedupeKey: `task:${record.id}:due:${dueAt.toISOString()}:${offset}:${memberId}` });
      }
    }
  }
  return events;
}

async function cancelDueNotifications(context: Context, recordId: string) {
  const rows = await readJsonl<NotificationRow>(`${dataDir}/notifications.jsonl`);
  await writeJsonl(`${dataDir}/notifications.jsonl`, rows.map((row) => row.familyId === context.familyId && row.dedupeKey.startsWith(`task:${recordId}:due:`) && ["queued", "dispatching"].includes(row.status) ? { ...row, status: "canceled" } : row));
}

async function cancelTaskNotifications(context: Context, recordId: string) {
  const rows = await readJsonl<NotificationRow>(`${dataDir}/notifications.jsonl`);
  await writeJsonl(`${dataDir}/notifications.jsonl`, rows.map((row) => row.familyId === context.familyId && row.deepLink === `/?record=${encodeURIComponent(recordId)}` && row.status !== "canceled" ? { ...row, status: "canceled" } : row));
}

export async function cancelRecordNotifications(context: Context, recordId: string) {
  await cancelTaskNotifications(context, recordId);
}

async function persistNotificationEvents(context: Context, recordId: string, events: Array<{ recipientMemberId: string; type: NotificationType; title: string; body: string; scheduledFor: string; dedupeKey: string }>, deepLink = recordId ? `/?record=${encodeURIComponent(recordId)}` : "/") {
  if (!events.length) return;
  const preferencesByMember = new Map<string, NotificationPreferences>();
  for (const event of events) {
    const preferences = preferencesByMember.get(event.recipientMemberId) || await readNotificationPreferences({ familyId: context.familyId, memberId: event.recipientMemberId });
    preferencesByMember.set(event.recipientMemberId, preferences);
    if (!isTypeEnabled(event.type, preferences)) continue;
    const deliverAfter = applyQuietHours(event.scheduledFor, preferences);
    await appendJsonl("notifications.jsonl", { id: crypto.randomUUID(), familyId: context.familyId, actorMemberId: context.memberId, status: "queued", deepLink, createdAt: new Date().toISOString(), readAt: null, deliverAfter, ...event });
  }
}

export function applyQuietHours(iso: string, preferences: NotificationPreferences) {
  const date = new Date(iso);
  const local = new Intl.DateTimeFormat("en-CA", { timeZone: preferences.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type: string) => Number(local.find((part) => part.type === type)?.value || 0);
  const minutes = get("hour") * 60 + get("minute");
  const start = parseMinutes(preferences.quietStart); const end = parseMinutes(preferences.quietEnd);
  if (!(minutes >= start || minutes < end)) return iso;
  const delayMinutes = minutes >= start ? 24 * 60 - minutes + end : end - minutes;
  return new Date(date.getTime() + delayMinutes * 60_000).toISOString();
}
export function isNotificationVisible(notification: { deliverAfter?: string; status: string }, now = new Date().toISOString()) {
  return notification.status !== "canceled" && (!notification.deliverAfter || notification.deliverAfter <= now);
}

function isTypeEnabled(type: NotificationType, preferences: NotificationPreferences) {
  if (!preferences.inAppEnabled && !preferences.pushEnabled) return false;
  if (type === "decision_invited" || type === "decision_closed") return preferences.chatMessageEnabled;
  return type === "task_assigned" ? preferences.taskAssignedEnabled : type === "chat_message" ? preferences.chatMessageEnabled : preferences.dueReminderEnabled;
}
function parseMinutes(value: string) { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; }
async function appendJsonl(fileName: string, row: unknown) { await mkdir(dataDir, { recursive: true }); await appendFile(`${dataDir}/${fileName}`, `${JSON.stringify(row)}\n`, "utf8"); }
async function readJsonl<T>(path: string): Promise<T[]> { try { return (await readFile(path, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as T); } catch { return []; } }
async function writeJsonl(path: string, rows: unknown[]) { await mkdir(dataDir, { recursive: true }); await writeFile(path, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), "utf8"); }
