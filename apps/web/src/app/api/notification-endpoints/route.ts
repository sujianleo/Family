import { NextResponse } from "next/server";
import type { NotificationPlatform } from "@/lib/notifications";
import { FamilyRequestContextError, requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { registerNotificationEndpoint, unregisterNotificationEndpoint } from "@/lib/server/notificationStore";

const platforms = new Set<NotificationPlatform>(["ios_pwa", "android_pwa", "desktop_pwa"]);

export async function POST(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request); const body = await request.json() as Record<string, unknown>;
    const deviceId = readString(body.deviceId); const platform = readString(body.platform) as NotificationPlatform;
    const subscription = body.subscription && typeof body.subscription === "object" ? body.subscription as Record<string, unknown> : {};
    const keys = subscription.keys && typeof subscription.keys === "object" ? subscription.keys as Record<string, unknown> : {};
    const input = { deviceId, platform, endpoint: readString(subscription.endpoint), p256dh: readString(keys.p256dh), auth: readString(keys.auth) };
    if (!deviceId || !platforms.has(platform) || !input.endpoint || !input.p256dh || !input.auth) return NextResponse.json({ detail: "无效的 Web Push 订阅。" }, { status: 400 });
    await registerNotificationEndpoint(context, input); return NextResponse.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request) {
  try { const context = await requireFamilyRequestContext(request); const deviceId = new URL(request.url).searchParams.get("device_id") || ""; if (!deviceId) return NextResponse.json({ detail: "缺少 device_id。" }, { status: 400 }); await unregisterNotificationEndpoint(context, deviceId); return NextResponse.json({ ok: true }); }
  catch (error) { return errorResponse(error); }
}
function readString(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function errorResponse(error: unknown) { if (error instanceof FamilyRequestContextError) return NextResponse.json({ detail: error.message }, { status: error.status }); return NextResponse.json({ detail: error instanceof Error ? error.message : "通知终端请求失败。" }, { status: 500 }); }
