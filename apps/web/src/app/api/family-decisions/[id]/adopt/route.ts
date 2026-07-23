import { NextResponse } from "next/server";
import { requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { getFamilyDecision, markDecisionAdopted } from "@/lib/server/decisionStore";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireFamilyRequestContext(request); const { id } = await params; const decision = await getFamilyDecision(context, id);
    if (!decision || decision.status !== "closed") return NextResponse.json({ detail: "家庭决定尚未结束。" }, { status: 409 });
    if (decision.adoptedTaskId) return NextResponse.json({ detail: "该方案已经创建过任务。", task_id: decision.adoptedTaskId }, { status: 409 });
    const recommendation = decision.summaryJson?.recommendation;
    if (!recommendation || recommendation === "未形成唯一多数") return NextResponse.json({ detail: "当前没有可直接采纳的唯一方案。" }, { status: 409 });
    return NextResponse.json({
      ok: true,
      actionId: "task.create.approval",
      display: { target: "task_list", type: "task_candidate", requiresConfirmation: true, dismissible: true },
      userReply: `建议把“${recommendation}”创建为家庭任务。`,
      data: { decision_id: id, title: recommendation, source_text: decision.question, requires_confirmation: true }
    });
  } catch (error) { return NextResponse.json({ detail: error instanceof Error ? error.message : "采纳失败。" }, { status: 400 }); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireFamilyRequestContext(request); const { id } = await params; const body = await request.json() as { task_id?: unknown };
    if (typeof body.task_id !== "string" || !body.task_id) return NextResponse.json({ detail: "缺少任务 id。" }, { status: 400 });
    await markDecisionAdopted(context, id, body.task_id);
    return NextResponse.json({ ok: true, task_id: body.task_id });
  } catch (error) { return NextResponse.json({ detail: error instanceof Error ? error.message : "采纳失败。" }, { status: 400 }); }
}
