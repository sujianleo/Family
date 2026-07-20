import { NextResponse } from "next/server";
import { FamilyRequestContextError, requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { extendGroupJudgement } from "@/lib/server/groupJudgementService";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireFamilyRequestContext(request);
    const { id } = await context.params;
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const minutes = typeof body.minutes === "number" ? body.minutes : 120;
    return NextResponse.json({ judgement: await extendGroupJudgement(actor, id, minutes) });
  } catch (error) {
    if (error instanceof FamilyRequestContextError) return NextResponse.json({ detail: error.message }, { status: error.status });
    return NextResponse.json({ detail: error instanceof Error ? error.message : "延长失败。" }, { status: 400 });
  }
}
