import { NextResponse } from "next/server";
import { FamilyRequestContextError, requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { confirmSuggestedJudgementStance, dismissSuggestedJudgementStance, setGroupJudgementStance } from "@/lib/server/groupJudgementService";
import type { JudgementStance } from "@/lib/groupJudgement";

export const runtime = "nodejs";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireFamilyRequestContext(request);
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    if (body.dismiss === true) return NextResponse.json({ judgement: await dismissSuggestedJudgementStance(actor, id) });
    const stance = typeof body.stance === "string" ? body.stance as JudgementStance : "undecided";
    const judgement = body.confirmed === true
      ? await confirmSuggestedJudgementStance(actor, id, stance)
      : await setGroupJudgementStance(actor, id, stance);
    return NextResponse.json({ judgement });
  } catch (error) {
    if (error instanceof FamilyRequestContextError) return NextResponse.json({ detail: error.message }, { status: error.status });
    return NextResponse.json({ detail: error instanceof Error ? error.message : "立场保存失败。" }, { status: 400 });
  }
}
