import { NextResponse } from "next/server";
import { FamilyRequestContextError, requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { clearNotifications, listNotifications, markNotificationsRead } from "@/lib/server/notificationStore";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const limit = Math.max(1, Math.min(100, Number(new URL(request.url).searchParams.get("limit") || 50)));
    return NextResponse.json(await listNotifications(context, limit));
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const body = await request.json() as { id?: unknown; all?: unknown };
    const id = typeof body.id === "string" ? body.id : undefined;
    const all = body.all === true;
    if (!all && !id) return NextResponse.json({ detail: "缺少通知 id。" }, { status: 400 });
    await markNotificationsRead(context, { id, all });
    return NextResponse.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    await clearNotifications(context);
    return NextResponse.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}

function errorResponse(error: unknown) {
  if (error instanceof FamilyRequestContextError) return NextResponse.json({ detail: error.message }, { status: error.status });
  return NextResponse.json({ detail: error instanceof Error ? error.message : "通知请求失败。" }, { status: 500 });
}
