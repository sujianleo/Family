import type { FamilyNotification } from "./notifications";

export const dismissedNotificationIdsSessionKey = "family-app.notifications.dismissed-ids";
export const maxDismissedNotificationIds = 200;

type SessionStorageLike = Pick<Storage, "getItem" | "setItem">;

export function readDismissedNotificationIds(storage?: SessionStorageLike): string[] {
  if (!storage) {
    return [];
  }

  try {
    const value = JSON.parse(storage.getItem(dismissedNotificationIdsSessionKey) || "[]") as unknown;
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((item): item is string => typeof item === "string" && item.length > 0).slice(-maxDismissedNotificationIds);
  } catch {
    return [];
  }
}

export function mergeDismissedNotificationIds(current: Iterable<string>, incoming: Iterable<string>): string[] {
  const merged = new Set<string>();
  for (const id of current) {
    if (id) merged.add(id);
  }
  for (const id of incoming) {
    if (!id) continue;
    merged.delete(id);
    merged.add(id);
  }
  return [...merged].slice(-maxDismissedNotificationIds);
}

export function writeDismissedNotificationIds(storage: SessionStorageLike | undefined, ids: Iterable<string>) {
  if (!storage) {
    return;
  }
  storage.setItem(dismissedNotificationIdsSessionKey, JSON.stringify([...ids].slice(-maxDismissedNotificationIds)));
}

export function hasUndismissedNotification(notifications: FamilyNotification[], dismissedIds: ReadonlySet<string>) {
  return notifications.some((notification) => !notification.readAt && !dismissedIds.has(notification.id));
}
