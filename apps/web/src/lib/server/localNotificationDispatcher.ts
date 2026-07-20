import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import webpush from "web-push";

type LocalNotificationRow = { id: string; recipientMemberId: string; type: string; title: string; body: string; deepLink: string; status: string; deliverAfter: string; scheduledFor: string; readAt?: string | null };
type LocalEndpointRow = { deviceId: string; memberId: string; endpoint: string; p256dh: string; auth: string; active: boolean; updatedAt: string };
type LocalDeliveryRow = { notificationId: string; deviceId: string; result: "sent" | "invalid" | "retryable" | "failed"; attemptedAt: string };
type SendPush = (subscription: webpush.PushSubscription, payload: string) => Promise<void>;

const dispatcherIntervalMs = 5_000;
const retryDelayMs = 5 * 60_000;
const maximumAttempts = 4;
const maximumTaskLatenessMs = 6 * 60 * 60_000;
const maximumOtherLatenessMs = 60 * 60_000;
let dispatchRunning = false;

declare global { var familyAppLocalNotificationDispatcher: ReturnType<typeof setInterval> | undefined; }

export function startLocalNotificationDispatcher() {
  if (process.env.FAMILY_APP_ALLOW_FILE_FALLBACK !== "true") return;
  if (!configureWebPush() || globalThis.familyAppLocalNotificationDispatcher) return;
  const run = () => void dispatchLocalNotifications().catch((error) => console.error("[notification-dispatch]", error));
  run();
  globalThis.familyAppLocalNotificationDispatcher = setInterval(run, dispatcherIntervalMs);
  globalThis.familyAppLocalNotificationDispatcher.unref?.();
  console.info("[notification-dispatch] local Web Push dispatcher started");
}

export async function sendLocalPushTest(memberId: string, deviceId: string, dataDir = path.resolve(process.cwd(), "data")) {
  if (!configureWebPush()) throw new Error("Web Push 密钥尚未配置。");
  const endpoints = latestActiveEndpoints(await readJsonl<LocalEndpointRow>(path.join(dataDir, "notification-endpoints.jsonl")));
  const endpoint = endpoints.find((item) => item.memberId === memberId && item.deviceId === deviceId);
  if (!endpoint) throw new Error("当前设备的 Push 订阅尚未保存。");
  await webpush.sendNotification(
    { endpoint: endpoint.endpoint, keys: { p256dh: endpoint.p256dh, auth: endpoint.auth } },
    JSON.stringify({ id: `background-test-${Date.now()}`, title: "饭米粒后台通知已开启", body: "关闭或离开 App 后，任务到点也会通过系统通知提醒你。", deepLink: "/", unreadCount: 0 })
  );
}

export async function dispatchLocalNotifications(options: { dataDir?: string; now?: number; sendPush?: SendPush } = {}) {
  if (dispatchRunning) return { attempted: 0, sent: 0 };
  dispatchRunning = true;
  try {
    const dataDir = options.dataDir || path.resolve(process.cwd(), "data");
    const now = options.now ?? Date.now();
    const sendPush = options.sendPush || ((subscription, payload) => webpush.sendNotification(subscription, payload).then(() => undefined));
    const [notifications, endpointRows, deliveryRows] = await Promise.all([
      readJsonl<LocalNotificationRow>(path.join(dataDir, "notifications.jsonl")),
      readJsonl<LocalEndpointRow>(path.join(dataDir, "notification-endpoints.jsonl")),
      readJsonl<LocalDeliveryRow>(path.join(dataDir, "notification-deliveries.jsonl"))
    ]);
    const endpoints = latestActiveEndpoints(endpointRows);
    const attemptsByDelivery = groupDeliveries(deliveryRows);
    const unreadByMember = new Map<string, number>();
    for (const notification of notifications) {
      if (!notification.readAt && notification.status !== "canceled") unreadByMember.set(notification.recipientMemberId, (unreadByMember.get(notification.recipientMemberId) || 0) + 1);
    }
    let attempted = 0;
    let sent = 0;
    for (const notification of notifications) {
      if (!isDispatchable(notification, now)) continue;
      for (const endpoint of endpoints.filter((item) => item.memberId === notification.recipientMemberId)) {
        const deliveryKey = `${notification.id}:${endpoint.deviceId}`;
        const priorAttempts = attemptsByDelivery.get(deliveryKey) || [];
        if (!shouldAttempt(priorAttempts, now)) continue;
        attempted += 1;
        const payload = JSON.stringify({ id: notification.id, title: notification.title, body: notification.body, deepLink: notification.deepLink || "/", unreadCount: unreadByMember.get(notification.recipientMemberId) || 0 });
        let result: LocalDeliveryRow["result"] = "sent";
        try {
          await sendPush({ endpoint: endpoint.endpoint, keys: { p256dh: endpoint.p256dh, auth: endpoint.auth } }, payload);
          sent += 1;
        } catch (error) {
          const statusCode = readStatusCode(error);
          result = statusCode === 404 || statusCode === 410 ? "invalid" : statusCode === 408 || statusCode === 429 || statusCode >= 500 ? "retryable" : "failed";
        }
        const delivery = { notificationId: notification.id, deviceId: endpoint.deviceId, result, attemptedAt: new Date(now).toISOString() } satisfies LocalDeliveryRow;
        await appendJsonl(path.join(dataDir, "notification-deliveries.jsonl"), delivery);
        priorAttempts.push(delivery);
        attemptsByDelivery.set(deliveryKey, priorAttempts);
      }
    }
    return { attempted, sent };
  } finally {
    dispatchRunning = false;
  }
}

function isDispatchable(notification: LocalNotificationRow, now: number) {
  if (notification.status === "canceled" || !notification.deliverAfter) return false;
  const deliverAfter = new Date(notification.deliverAfter).getTime();
  if (!Number.isFinite(deliverAfter) || deliverAfter > now) return false;
  const maximumLateness = notification.type === "task_due" ? maximumTaskLatenessMs : maximumOtherLatenessMs;
  return now - deliverAfter <= maximumLateness;
}

function latestActiveEndpoints(rows: LocalEndpointRow[]) {
  const latest = new Map<string, LocalEndpointRow>();
  for (const row of rows) {
    if (!row.deviceId || !row.memberId || !row.endpoint || !row.p256dh || !row.auth) continue;
    const key = `${row.memberId}:${row.deviceId}`;
    const current = latest.get(key);
    if (!current || row.updatedAt >= current.updatedAt) latest.set(key, row);
  }
  return [...latest.values()].filter((row) => row.active !== false);
}

function groupDeliveries(rows: LocalDeliveryRow[]) {
  const grouped = new Map<string, LocalDeliveryRow[]>();
  for (const row of rows) {
    const key = `${row.notificationId}:${row.deviceId}`;
    grouped.set(key, [...(grouped.get(key) || []), row]);
  }
  return grouped;
}

function shouldAttempt(attempts: LocalDeliveryRow[], now: number) {
  if (attempts.some((attempt) => attempt.result === "sent" || attempt.result === "invalid" || attempt.result === "failed")) return false;
  if (attempts.length >= maximumAttempts) return false;
  const lastAttempt = attempts.at(-1);
  return !lastAttempt || now - new Date(lastAttempt.attemptedAt).getTime() >= retryDelayMs;
}

function readStatusCode(error: unknown) { return typeof error === "object" && error && "statusCode" in error ? Number(error.statusCode) : 0; }
function configureWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@family-app.local", publicKey, privateKey);
  return true;
}
async function readJsonl<T>(filePath: string): Promise<T[]> { try { return (await readFile(filePath, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as T); } catch { return []; } }
async function appendJsonl(filePath: string, row: unknown) { await mkdir(path.dirname(filePath), { recursive: true }); await appendFile(filePath, `${JSON.stringify(row)}\n`, "utf8"); }
