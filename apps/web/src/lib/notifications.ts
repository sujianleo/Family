export type NotificationType =
  | "task_assigned"
  | "chat_message"
  | "task_due"
  | "decision_invited"
  | "decision_due"
  | "decision_closed"
  | "assistant_digest";
export type NotificationPlatform = "ios_pwa" | "android_pwa" | "desktop_pwa" | "android_native";
export type NotificationChannel = "web_push" | "fcm";
export type NotificationDeliveryResult = "sent" | "invalid_endpoint" | "retryable_failure" | "permanent_failure";
export type NotificationDeliveryEndpoint = { id: string; channel: NotificationChannel; platform: NotificationPlatform };
export type NotificationDeliveryPayload = { id: string; title: string; body: string; deepLink: string; unreadCount: number };
export interface NotificationDeliveryProvider {
  send(endpoint: NotificationDeliveryEndpoint, payload: NotificationDeliveryPayload): Promise<NotificationDeliveryResult>;
}

export type FamilyNotification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  deepLink: string;
  actorMemberId?: string | null;
  scheduledFor: string;
  readAt?: string | null;
  createdAt: string;
};

export type NotificationPreferences = {
  inAppEnabled: boolean;
  pushEnabled: boolean;
  taskAssignedEnabled: boolean;
  chatMessageEnabled: boolean;
  dueReminderEnabled: boolean;
  timezone: string;
  quietStart: string;
  quietEnd: string;
  reminderOffsets: number[];
};

export const defaultNotificationPreferences: NotificationPreferences = {
  inAppEnabled: true,
  pushEnabled: true,
  taskAssignedEnabled: true,
  chatMessageEnabled: true,
  dueReminderEnabled: true,
  timezone: "Asia/Shanghai",
  quietStart: "22:00",
  quietEnd: "08:00",
  reminderOffsets: [15, 0]
};
