import { NextResponse } from "next/server";
import { FamilyRequestContextError, requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { getGroupJudgement } from "@/lib/server/groupJudgementService";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireFamilyRequestContext(request);
    const { id } = await context.params;
    const judgement = await getGroupJudgement(actor, id);
    if (!judgement) return NextResponse.json({ detail: "评评理不存在。" }, { status: 404 });
    return NextResponse.json({ judgement });
  } catch (error) {
    if (error instanceof FamilyRequestContextError) return NextResponse.json({ detail: error.message }, { status: error.status });
    return NextResponse.json({ detail: error instanceof Error ? error.message : "读取失败。" }, { status: 400 });
  }
}
