import { NextResponse } from "next/server";
import { FamilyRequestContextError, requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { createGroupJudgement, listGroupJudgements } from "@/lib/server/groupJudgementService";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const roomRecordId = new URL(request.url).searchParams.get("roomRecordId")?.trim() || "";
    return NextResponse.json({ judgements: await listGroupJudgements(context, roomRecordId) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const body = await request.json() as Record<string, unknown>;
    const text = (key: string) => typeof body[key] === "string" ? body[key] as string : "";
    const judgement = await createGroupJudgement(context, {
      endsAt: text("ends_at") || undefined,
      leftLabel: text("left_label"),
      leftMemberId: text("left_member_id") || undefined,
      rightLabel: text("right_label"),
      rightMemberId: text("right_member_id") || undefined,
      roomRecordId: text("room_record_id"),
      spaceId: text("space_id") || undefined,
      statement: text("statement"),
      title: text("title")
    });
    return NextResponse.json({ judgement }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

function errorResponse(error: unknown) {
  if (error instanceof FamilyRequestContextError) return NextResponse.json({ detail: error.message }, { status: error.status });
  return NextResponse.json({ detail: error instanceof Error ? error.message : "评评理请求失败。" }, { status: 400 });
}
