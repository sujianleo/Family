import { NextResponse } from "next/server";
import { requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { getFamilyDecision, updateFamilyDecision } from "@/lib/server/decisionStore";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireFamilyRequestContext(request); const { id } = await params;
    const decision = await getFamilyDecision(context, id);
    return decision ? NextResponse.json({ decision }) : NextResponse.json({ detail: "家庭决定不存在或无权查看。" }, { status: 404 });
  } catch (error) { return NextResponse.json({ detail: error instanceof Error ? error.message : "读取失败。" }, { status: 400 }); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireFamilyRequestContext(request); const { id } = await params;
    const body = await request.json() as Record<string, unknown>;
    const decision = await updateFamilyDecision(context, id, {
      question: typeof body.question === "string" ? body.question : "",
      options: Array.isArray(body.options) ? body.options.filter((item): item is string => typeof item === "string") : [],
      closesAt: typeof body.closes_at === "string" ? body.closes_at : ""
    });
    return NextResponse.json({ decision });
  } catch (error) { return NextResponse.json({ detail: error instanceof Error ? error.message : "修改失败。" }, { status: 400 }); }
}
