import { NextResponse } from "next/server";
import { FamilyRequestContextError, requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { suggestGroupJudgementStance } from "@/lib/server/groupJudgementService";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireFamilyRequestContext(request);
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const judgement = await suggestGroupJudgementStance(actor, id, {
      messageId: typeof body.message_id === "string" ? body.message_id : "",
      text: typeof body.text === "string" ? body.text : ""
    });
    return NextResponse.json({ judgement });
  } catch (error) {
    if (error instanceof FamilyRequestContextError) return NextResponse.json({ detail: error.message }, { status: error.status });
    return NextResponse.json({ detail: error instanceof Error ? error.message : "候选立场识别失败。" }, { status: 400 });
  }
}
