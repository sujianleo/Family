import { NextResponse } from "next/server";
import { FamilyRequestContextError, requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { closeGroupJudgement } from "@/lib/server/groupJudgementService";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireFamilyRequestContext(request);
    const { id } = await context.params;
    return NextResponse.json({ judgement: await closeGroupJudgement(actor, id) });
  } catch (error) {
    if (error instanceof FamilyRequestContextError) return NextResponse.json({ detail: error.message }, { status: error.status });
    return NextResponse.json({ detail: error instanceof Error ? error.message : "结束失败。" }, { status: 400 });
  }
}
