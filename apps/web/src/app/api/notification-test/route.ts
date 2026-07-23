import { NextResponse } from "next/server";
import { FamilyRequestContextError, requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { sendLocalPushTest } from "@/lib/server/localNotificationDispatcher";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const body = await request.json() as { deviceId?: unknown };
    const deviceId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
    if (!deviceId) return NextResponse.json({ detail: "缺少 deviceId。" }, { status: 400 });
    await sendLocalPushTest(context.memberId, deviceId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof FamilyRequestContextError) return NextResponse.json({ detail: error.message }, { status: error.status });
    return NextResponse.json({ detail: error instanceof Error ? error.message : "后台测试通知发送失败。" }, { status: 500 });
  }
}
