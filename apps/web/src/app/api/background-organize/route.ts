import { NextResponse } from "next/server";
import { createBackgroundOrganizationNotifications } from "@/lib/server/backgroundOrganizationNotifications";
import { listBackgroundOrganizations, runBackgroundOrganization } from "@/lib/server/backgroundOrganizer";
import { FamilyRequestContextError, requireFamilyRequestContext } from "@/lib/server/familyRequestContext";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const limit = Math.max(1, Math.min(31, Number(new URL(request.url).searchParams.get("limit") || 7)));
    return NextResponse.json({
      ok: true,
      records: await listBackgroundOrganizations(context.familyId, limit)
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const body = (await request.json().catch(() => ({}))) as { force?: unknown; timeZone?: unknown };
    const now = new Date();
    const result = await runBackgroundOrganization({
      actorMemberId: context.memberId,
      endTime: now.toISOString(),
      familyId: context.familyId,
      force: body.force === true,
      startTime: new Date(now.getTime() - 24 * 60 * 60_000).toISOString(),
      timeZone: readString(body.timeZone) || "Asia/Shanghai",
      useAi: process.env.FAMILY_APP_BACKGROUND_AI_ENABLED !== "false"
    });
    if (!result.skipped && result.record) {
      await createBackgroundOrganizationNotifications(
        [{ familyId: context.familyId, memberId: context.memberId }],
        result.record
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  if (error instanceof FamilyRequestContextError) {
    return NextResponse.json({ detail: error.message, ok: false }, { status: error.status });
  }
  return NextResponse.json(
    { detail: error instanceof Error ? error.message : "后台整理失败。", ok: false },
    { status: 500 }
  );
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
