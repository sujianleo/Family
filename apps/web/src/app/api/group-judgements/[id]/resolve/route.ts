import { NextResponse } from "next/server";
import { FamilyRequestContextError, requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { resolveGroupJudgementTie } from "@/lib/server/groupJudgementService";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireFamilyRequestContext(request);
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    if (body.stance !== "left" && body.stance !== "right") return NextResponse.json({ detail: "最终选择无效。" }, { status: 400 });
    return NextResponse.json({ judgement: await resolveGroupJudgementTie(actor, id, body.stance) });
  } catch (error) {
    if (error instanceof FamilyRequestContextError) return NextResponse.json({ detail: error.message }, { status: error.status });
    return NextResponse.json({ detail: error instanceof Error ? error.message : "保存最终选择失败。" }, { status: 400 });
  }
}
