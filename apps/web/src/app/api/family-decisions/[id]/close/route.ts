import { NextResponse } from "next/server";
import { requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { closeFamilyDecision } from "@/lib/server/decisionStore";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { const context = await requireFamilyRequestContext(request); const { id } = await params; return NextResponse.json({ decision: await closeFamilyDecision(context, id) }); }
  catch (error) { return NextResponse.json({ detail: error instanceof Error ? error.message : "结束失败。" }, { status: 400 }); }
}
