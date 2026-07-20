import { createClient } from "@supabase/supabase-js";
import { FcmProvider, WebPushProvider, type NotificationEndpoint, type NotificationPayload } from "./providers.ts";

Deno.serve(async (request) => {
  if (request.headers.get("x-dispatch-key") !== Deno.env.get("NOTIFICATION_DISPATCH_KEY")) {
    return Response.json({ detail: "unauthorized" }, { status: 401 });
  }
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: notifications, error } = await supabase.rpc("claim_due_notifications", { batch_size: 100 });
  if (error) return Response.json({ detail: error.message }, { status: 500 });
  const webPush = new WebPushProvider(
    Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com",
    Deno.env.get("VAPID_PUBLIC_KEY")!,
    Deno.env.get("VAPID_PRIVATE_KEY")!
  );
  const fcm = new FcmProvider();
  const outcomes = [];

  for (const notification of notifications || []) {
    const { data: preference } = await supabase
      .from("notification_preferences")
      .select("push_enabled")
      .eq("member_id", notification.recipient_member_id)
      .maybeSingle();
    if (preference?.push_enabled === false) {
      await supabase.from("notifications").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", notification.id);
      outcomes.push({ id: notification.id, status: "in_app_only" });
      continue;
    }
    const { data: endpoints } = await supabase
      .from("notification_endpoints")
      .select("id, channel, endpoint, p256dh, auth")
      .eq("member_id", notification.recipient_member_id)
      .eq("active", true);
    const { count } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_member_id", notification.recipient_member_id)
      .is("read_at", null)
      .neq("status", "canceled");
    const payload: NotificationPayload = {
      id: notification.id,
      title: notification.title,
      body: notification.body,
      deepLink: notification.deep_link,
      unreadCount: count || 0
    };
    let sent = false;
    let retryable = false;
    for (const endpoint of (endpoints || []) as NotificationEndpoint[]) {
      const provider = endpoint.channel === "web_push" ? webPush : fcm;
      const result = await provider.send(endpoint, payload);
      sent ||= result === "sent";
      retryable ||= result === "retryable_failure";
      await updateEndpoint(supabase, endpoint.id, result);
    }
    const status = sent ? "sent" : retryable && notification.attempt_count < 4 ? "queued" : "failed";
    const retryAfter = status === "queued" ? new Date(Date.now() + 5 * 60_000).toISOString() : notification.deliver_after;
    await supabase.from("notifications").update({ status, sent_at: sent ? new Date().toISOString() : null, deliver_after: retryAfter }).eq("id", notification.id);
    outcomes.push({ id: notification.id, status });
  }
  return Response.json({ processed: outcomes.length, outcomes });
});

async function updateEndpoint(supabase: ReturnType<typeof createClient>, id: string, result: string) {
  if (result === "sent") {
    await supabase.from("notification_endpoints").update({ failure_count: 0, last_success_at: new Date().toISOString() }).eq("id", id);
  } else if (result === "invalid_endpoint") {
    await supabase.from("notification_endpoints").update({ active: false, last_failure_at: new Date().toISOString() }).eq("id", id);
  } else {
    const { data } = await supabase.from("notification_endpoints").select("failure_count").eq("id", id).single();
    const failureCount = Number(data?.failure_count || 0) + 1;
    await supabase.from("notification_endpoints").update({ failure_count: failureCount, active: failureCount < 5, last_failure_at: new Date().toISOString() }).eq("id", id);
  }
}
