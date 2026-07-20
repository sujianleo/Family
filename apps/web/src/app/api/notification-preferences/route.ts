import { NextResponse } from "next/server";
import { defaultNotificationPreferences, type NotificationPreferences } from "@/lib/notifications";
import { FamilyRequestContextError, requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { readNotificationPreferences, writeNotificationPreferences } from "@/lib/server/notificationStore";

export async function GET(request: Request) {
  try { const context = await requireFamilyRequestContext(request); return NextResponse.json({ preferences: await readNotificationPreferences(context) }); }
  catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const current = await readNotificationPreferences(context);
    const body = await request.json() as Partial<NotificationPreferences>;
    const preferences: NotificationPreferences = {
      ...defaultNotificationPreferences, ...current,
      inAppEnabled: readBoolean(body.inAppEnabled, current.inAppEnabled), pushEnabled: readBoolean(body.pushEnabled, current.pushEnabled),
      taskAssignedEnabled: readBoolean(body.taskAssignedEnabled, current.taskAssignedEnabled), chatMessageEnabled: readBoolean(body.chatMessageEnabled, current.chatMessageEnabled), dueReminderEnabled: readBoolean(body.dueReminderEnabled, current.dueReminderEnabled),
      timezone: typeof body.timezone === "string" && body.timezone.length < 80 ? body.timezone : current.timezone,
      quietStart: validTime(body.quietStart) ? body.quietStart! : current.quietStart, quietEnd: validTime(body.quietEnd) ? body.quietEnd! : current.quietEnd,
      reminderOffsets: Array.isArray(body.reminderOffsets) ? body.reminderOffsets.filter((value) => Number.isInteger(value) && value >= 0 && value <= 10080).slice(0, 4) : current.reminderOffsets
    };
    await writeNotificationPreferences(context, preferences); return NextResponse.json({ preferences });
  } catch (error) { return errorResponse(error); }
}
function readBoolean(value: unknown, fallback: boolean) { return typeof value === "boolean" ? value : fallback; }
function validTime(value: unknown): value is string { return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }
function errorResponse(error: unknown) { if (error instanceof FamilyRequestContextError) return NextResponse.json({ detail: error.message }, { status: error.status }); return NextResponse.json({ detail: error instanceof Error ? error.message : "通知偏好请求失败。" }, { status: 500 }); }
