import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServiceSupabaseClient } from "./supabaseServer";
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
  const supabase = createServiceSupabaseClient() as any;
  if (supabase && context.familyId && context.memberId) {
    const { data, error } = await supabase.from("notifications").select("id,type,title,body,deep_link,actor_member_id,scheduled_for,read_at,created_at").eq("family_id", context.familyId).eq("recipient_member_id", context.memberId).neq("status", "canceled").lte("deliver_after", now).order("created_at", { ascending: false }).limit(limit);
    if (error) throw error;
    const notifications: FamilyNotification[] = (data || []).map((row: Record<string, any>) => ({ id: row.id, type: row.type as NotificationType, title: row.title, body: row.body, deepLink: row.deep_link, actorMemberId: row.actor_member_id, scheduledFor: row.scheduled_for, readAt: row.read_at, createdAt: row.created_at }));
    return { notifications, unreadCount: notifications.filter((item: FamilyNotification) => !item.readAt).length };
  }
  const rows = (await readJsonl<NotificationRow>(`${dataDir}/notifications.jsonl`)).filter((row) => (row.recipientMemberId === context.memberId || !context.memberId) && isNotificationVisible(row, now));
  const latest = [...new Map(rows.map((row) => [row.dedupeKey || row.id, row])).values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  return { notifications: latest, unreadCount: latest.filter((item) => !item.readAt && item.status !== "canceled").length };
}

export async function markNotificationsRead(context: Context, input: { id?: string; all?: boolean }) {
  const now = new Date().toISOString();
  const supabase = createServiceSupabaseClient() as any;
  if (supabase && context.memberId) {
    let query = supabase.from("notifications").update({ read_at: now, updated_at: now }).eq("recipient_member_id", context.memberId);
    if (!input.all && input.id) query = query.eq("id", input.id);
    const { error } = await query;
    if (error) throw error;
    return;
  }
  const rows = await readJsonl<NotificationRow>(`${dataDir}/notifications.jsonl`);
  await writeJsonl(`${dataDir}/notifications.jsonl`, rows.map((row) => row.recipientMemberId === context.memberId && (input.all || row.id === input.id) ? { ...row, readAt: now } : row));
}

export async function clearNotifications(context: Context) {
  const now = new Date().toISOString();
  const supabase = createServiceSupabaseClient() as any;
  if (supabase && context.memberId) {
    const { error } = await supabase.from("notifications").update({ status: "canceled", updated_at: now }).eq("recipient_member_id", context.memberId);
    if (error) throw error;
    return;
  }
  const rows = await readJsonl<NotificationRow>(`${dataDir}/notifications.jsonl`);
  await writeJsonl(`${dataDir}/notifications.jsonl`, rows.map((row) => row.recipientMemberId === context.memberId ? { ...row, status: "canceled" } : row));
}

export async function readNotificationPreferences(context: Context): Promise<NotificationPreferences> {
  const supabase = createServiceSupabaseClient() as any;
  if (supabase && context.memberId) {
    let query = supabase.from("notification_preferences").select("*").eq("member_id", context.memberId);
    if (context.familyId) query = query.eq("family_id", context.familyId);
    const { data } = await query.maybeSingle();
    if (data) return fromPreferenceRow(data);
  }
  const rows = await readJsonl<{ memberId: string; preferences: NotificationPreferences }>(`${dataDir}/notification-preferences.jsonl`);
  return rows.reverse().find((row) => row.memberId === context.memberId)?.preferences || defaultNotificationPreferences;
}

export async function writeNotificationPreferences(context: Context, preferences: NotificationPreferences) {
  const supabase = createServiceSupabaseClient() as any;
  if (supabase && context.familyId && context.memberId) {
    const { error } = await supabase.from("notification_preferences").upsert(toPreferenceRow(context, preferences), { onConflict: "family_id,member_id" });
    if (error) throw error;
    return;
  }
  await appendJsonl("notification-preferences.jsonl", { memberId: context.memberId, preferences });
}

export async function registerNotificationEndpoint(context: Context, input: { deviceId: string; platform: NotificationPlatform; endpoint: string; p256dh: string; auth: string }) {
  const supabase = createServiceSupabaseClient() as any;
  if (supabase && context.familyId && context.memberId) {
    const { error } = await supabase.from("notification_endpoints").upsert({ family_id: context.familyId, member_id: context.memberId, channel: "web_push", platform: input.platform, device_id: input.deviceId, endpoint: input.endpoint, p256dh: input.p256dh, auth: input.auth, fcm_token: null, active: true, updated_at: new Date().toISOString() }, { onConflict: "family_id,member_id,channel,device_id" });
    if (error) throw error;
    return;
  }
  await appendJsonl("notification-endpoints.jsonl", { ...input, memberId: context.memberId, channel: "web_push", active: true, updatedAt: new Date().toISOString() });
}

export async function unregisterNotificationEndpoint(context: Context, deviceId: string) {
  const supabase = createServiceSupabaseClient() as any;
  if (supabase && context.memberId) {
    const { error } = await supabase.from("notification_endpoints").update({ active: false, updated_at: new Date().toISOString() }).eq("member_id", context.memberId).eq("device_id", deviceId);
    if (error) throw error;
  }
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
  const supabase = createServiceSupabaseClient() as any;
  if (supabase && context.familyId) {
    await supabase.from("notifications").update({ status: "canceled", updated_at: new Date().toISOString() }).eq("family_id", context.familyId).like("dedupe_key", `task:${recordId}:due:%`).in("status", ["queued", "dispatching"]);
    return;
  }
  const rows = await readJsonl<NotificationRow>(`${dataDir}/notifications.jsonl`);
  await writeJsonl(`${dataDir}/notifications.jsonl`, rows.map((row) => row.familyId === context.familyId && row.dedupeKey.startsWith(`task:${recordId}:due:`) && ["queued", "dispatching"].includes(row.status) ? { ...row, status: "canceled" } : row));
}

async function cancelTaskNotifications(context: Context, recordId: string) {
  const supabase = createServiceSupabaseClient() as any;
  if (supabase && context.familyId) {
    await supabase.from("notifications").update({ status: "canceled", updated_at: new Date().toISOString() }).eq("family_id", context.familyId).eq("source_record_id", recordId).neq("status", "canceled");
    return;
  }
  const rows = await readJsonl<NotificationRow>(`${dataDir}/notifications.jsonl`);
  await writeJsonl(`${dataDir}/notifications.jsonl`, rows.map((row) => row.familyId === context.familyId && row.deepLink === `/?record=${encodeURIComponent(recordId)}` && row.status !== "canceled" ? { ...row, status: "canceled" } : row));
}

export async function cancelRecordNotifications(context: Context, recordId: string) {
  await cancelTaskNotifications(context, recordId);
}

async function persistNotificationEvents(context: Context, recordId: string, events: Array<{ recipientMemberId: string; type: NotificationType; title: string; body: string; scheduledFor: string; dedupeKey: string }>, deepLink = recordId ? `/?record=${encodeURIComponent(recordId)}` : "/") {
  if (!events.length) return;
  const preferencesByMember = new Map<string, NotificationPreferences>();
  const supabase = createServiceSupabaseClient() as any;
  for (const event of events) {
    const preferences = preferencesByMember.get(event.recipientMemberId) || await readNotificationPreferences({ familyId: context.familyId, memberId: event.recipientMemberId });
    preferencesByMember.set(event.recipientMemberId, preferences);
    if (!isTypeEnabled(event.type, preferences)) continue;
    const deliverAfter = applyQuietHours(event.scheduledFor, preferences);
    if (supabase && context.familyId) {
      await supabase.from("notifications").upsert({ family_id: context.familyId, recipient_member_id: event.recipientMemberId, type: event.type, title: event.title, body: event.body, deep_link: deepLink, source_record_id: isUuid(recordId) ? recordId : null, actor_member_id: isUuid(context.memberId) ? context.memberId : null, scheduled_for: event.scheduledFor, deliver_after: deliverAfter, dedupe_key: event.dedupeKey, ...(["task_due", "decision_due"].includes(event.type) ? { status: "queued", claimed_at: null, sent_at: null } : {}) }, { onConflict: "dedupe_key", ignoreDuplicates: !["task_due", "decision_due"].includes(event.type) });
    } else {
      await appendJsonl("notifications.jsonl", { id: crypto.randomUUID(), familyId: context.familyId, actorMemberId: context.memberId, status: "queued", deepLink, createdAt: new Date().toISOString(), readAt: null, deliverAfter, ...event });
    }
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
function isUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function fromPreferenceRow(row: Record<string, unknown>): NotificationPreferences { return { inAppEnabled: Boolean(row.in_app_enabled), pushEnabled: Boolean(row.push_enabled), taskAssignedEnabled: Boolean(row.task_assigned_enabled), chatMessageEnabled: Boolean(row.chat_message_enabled), dueReminderEnabled: Boolean(row.due_reminder_enabled), timezone: String(row.timezone || "Asia/Shanghai"), quietStart: String(row.quiet_start || "22:00").slice(0, 5), quietEnd: String(row.quiet_end || "08:00").slice(0, 5), reminderOffsets: Array.isArray(row.reminder_offsets) ? row.reminder_offsets.map(Number) : [15, 0] }; }
function toPreferenceRow(context: Context, value: NotificationPreferences) { return { family_id: context.familyId, member_id: context.memberId, in_app_enabled: value.inAppEnabled, push_enabled: value.pushEnabled, task_assigned_enabled: value.taskAssignedEnabled, chat_message_enabled: value.chatMessageEnabled, due_reminder_enabled: value.dueReminderEnabled, timezone: value.timezone, quiet_start: value.quietStart, quiet_end: value.quietEnd, reminder_offsets: value.reminderOffsets, updated_at: new Date().toISOString() }; }
async function appendJsonl(fileName: string, row: unknown) { await mkdir(dataDir, { recursive: true }); await appendFile(`${dataDir}/${fileName}`, `${JSON.stringify(row)}\n`, "utf8"); }
async function readJsonl<T>(path: string): Promise<T[]> { try { return (await readFile(path, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as T); } catch { return []; } }
async function writeJsonl(path: string, rows: unknown[]) { await mkdir(dataDir, { recursive: true }); await writeFile(path, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), "utf8"); }
