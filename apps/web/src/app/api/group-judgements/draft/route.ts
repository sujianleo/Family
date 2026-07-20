import { NextResponse } from "next/server";
import { FamilyRequestContextError, requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { draftGroupJudgement } from "@/lib/server/groupJudgementService";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const body = await request.json() as Record<string, unknown>;
    const draft = await draftGroupJudgement(context, {
      roomRecordId: typeof body.room_record_id === "string" ? body.room_record_id : "",
      statement: typeof body.statement === "string" ? body.statement : ""
    });
    return NextResponse.json({ draft });
  } catch (error) {
    if (error instanceof FamilyRequestContextError) return NextResponse.json({ detail: error.message }, { status: error.status });
    return NextResponse.json({ detail: error instanceof Error ? error.message : "AI 整理失败。" }, { status: 400 });
  }
}
