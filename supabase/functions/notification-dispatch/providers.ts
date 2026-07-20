import webpush from "web-push";

export type DeliveryResult = "sent" | "invalid_endpoint" | "retryable_failure" | "permanent_failure";
export type NotificationPayload = { id: string; title: string; body: string; deepLink: string; unreadCount: number };
export type NotificationEndpoint = {
  id: string;
  channel: "web_push" | "fcm";
  endpoint: string | null;
  p256dh: string | null;
  auth: string | null;
};

export interface NotificationDeliveryProvider {
  send(endpoint: NotificationEndpoint, payload: NotificationPayload): Promise<DeliveryResult>;
}

export class WebPushProvider implements NotificationDeliveryProvider {
  constructor(subject: string, publicKey: string, privateKey: string) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  }

  async send(endpoint: NotificationEndpoint, payload: NotificationPayload): Promise<DeliveryResult> {
    if (!endpoint.endpoint || !endpoint.p256dh || !endpoint.auth) return "invalid_endpoint";
    try {
      await webpush.sendNotification(
        { endpoint: endpoint.endpoint, keys: { p256dh: endpoint.p256dh, auth: endpoint.auth } },
        JSON.stringify(payload),
        { TTL: 3600, urgency: "normal" }
      );
      return "sent";
    } catch (error) {
      const statusCode = typeof error === "object" && error && "statusCode" in error ? Number(error.statusCode) : 0;
      if (statusCode === 404 || statusCode === 410) return "invalid_endpoint";
      if (statusCode === 408 || statusCode === 429 || statusCode >= 500) return "retryable_failure";
      return "permanent_failure";
    }
  }
}

export class FcmProvider implements NotificationDeliveryProvider {
  async send(): Promise<DeliveryResult> {
    return "permanent_failure";
  }
}
