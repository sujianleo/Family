import { NextResponse } from "next/server";
import { requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { voteFamilyDecision } from "@/lib/server/decisionStore";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireFamilyRequestContext(request); const { id } = await params; const body = await request.json() as { option_id?: unknown };
    if (typeof body.option_id !== "string") return NextResponse.json({ detail: "缺少选项。" }, { status: 400 });
    return NextResponse.json({ decision: await voteFamilyDecision(context, id, body.option_id) });
  } catch (error) { return NextResponse.json({ detail: error instanceof Error ? error.message : "投票失败。" }, { status: 400 }); }
}
