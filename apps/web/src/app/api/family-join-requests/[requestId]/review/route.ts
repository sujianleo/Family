import { NextResponse } from "next/server";
import { FamilyRequestContextError, requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { approveLiteJoinRequest, readLiteJoinRequest, rejectLiteJoinRequest } from "@/lib/server/liteInviteRepository";
import { listLiteFamilyRecords, readLiteAccounts, saveLiteFamilyRecord } from "@/lib/server/liteRepository";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  try {
    const context = await requireFamilyRequestContext(request);
    const { requestId } = await params;
    const body = await request.json().catch(() => ({})) as { decision?: unknown };
    const decision = body.decision === "approve" ? "approve" : body.decision === "reject" ? "reject" : null;
    if (!decision || !isUuid(requestId)) return NextResponse.json({ detail: "审核请求无效。" }, { status: 400 });
    return reviewLiteJoinRequest({ context, decision, requestId });
  } catch (error) {
    if (error instanceof FamilyRequestContextError) return NextResponse.json({ detail: error.message }, { status: error.status });
    return NextResponse.json({ detail: error instanceof Error ? error.message : "审核失败。" }, { status: 500 });
  }
}

function reviewLiteJoinRequest(input: {
  context: Awaited<ReturnType<typeof requireFamilyRequestContext>>;
  decision: "approve" | "reject";
  requestId: string;
}) {
  const actor = readLiteAccounts().find((account) => account.sub === input.context.userId && account.familyId === input.context.familyId);
  if (!actor || actor.role !== "admin") return NextResponse.json({ detail: "只有家庭管理员可以确认成员。" }, { status: 403 });
  const joinRequest = readLiteJoinRequest(input.requestId);
  if (!joinRequest || joinRequest.familyId !== input.context.familyId) return NextResponse.json({ detail: "加入申请不存在。" }, { status: 404 });
  if (joinRequest.status !== "pending") return NextResponse.json({ detail: "这个申请已经处理过了。" }, { status: 409 });
  try {
    if (input.decision === "reject") {
      rejectLiteJoinRequest(input.requestId, input.context.memberId);
      finishLiteReviewTask(input.context.familyId, input.requestId, "已拒绝");
      return NextResponse.json({ ok: true, status: "rejected" });
    }
    const memberId = approveLiteJoinRequest(input.requestId, input.context.memberId);
    finishLiteReviewTask(input.context.familyId, input.requestId, "已确认加入");
    return NextResponse.json({ memberId, ok: true, status: "approved" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "PHONE_ALREADY_REGISTERED") return NextResponse.json({ detail: "这个手机号已经注册。" }, { status: 409 });
    return NextResponse.json({ detail: "审核失败，请重试。" }, { status: 500 });
  }
}

function finishLiteReviewTask(familyId: string, requestId: string, outcome: string) {
  listLiteFamilyRecords(familyId, 500)
    .filter((record) => record.joinRequestId === requestId)
    .forEach((record) => saveLiteFamilyRecord(familyId, "me", { ...record, status: "done", summary: `${record.summary}\n审核结果：${outcome}`, updatedAt: "刚刚" }));
}

function isUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
