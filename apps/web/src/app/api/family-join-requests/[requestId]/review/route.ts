import { NextResponse } from "next/server";
import { FamilyRequestContextError, requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { createRawEvent } from "@/lib/server/eventStore";
import { createServiceSupabaseClient } from "@/lib/server/supabaseServer";
import { isLiteBackend } from "@/lib/server/familyBackend";
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
    if (isLiteBackend()) return reviewLiteJoinRequest({ context, decision, requestId });
    const service = createServiceSupabaseClient() as any;
    if (!service) return NextResponse.json({ detail: "家庭审核服务尚未配置。" }, { status: 503 });

    const [{ data: actor }, { data: family }] = await Promise.all([
      service.from("family_members").select("id,role,user_id").eq("id", context.memberId).eq("family_id", context.familyId).maybeSingle(),
      service.from("families").select("created_by").eq("id", context.familyId).maybeSingle()
    ]);
    if (!actor || (actor.role !== "owner" && family?.created_by !== context.userId)) return NextResponse.json({ detail: "只有家庭管理员可以确认成员。" }, { status: 403 });

    const { data: joinRequest } = await service.from("family_join_requests").select("*").eq("id", requestId).eq("family_id", context.familyId).maybeSingle();
    if (!joinRequest) return NextResponse.json({ detail: "加入申请不存在。" }, { status: 404 });
    if (joinRequest.status !== "pending") return NextResponse.json({ detail: "这个申请已经处理过了。" }, { status: 409 });
    const { data: invite } = await service.from("invites").select("*").eq("id", joinRequest.invite_id).eq("family_id", context.familyId).maybeSingle();
    if (!invite || invite.type !== "family" || invite.status === "revoked") return NextResponse.json({ detail: "家庭邀请已失效。" }, { status: 410 });

    if (decision === "reject") {
      await Promise.all([
        service.from("family_join_requests").update({ reviewed_at: new Date().toISOString(), reviewed_by_member_id: context.memberId, status: "rejected", updated_at: new Date().toISOString() }).eq("id", requestId),
        service.from("invites").update({ status: "revoked", updated_at: new Date().toISOString() }).eq("id", invite.id)
      ]);
      await finishReviewTask(service, context.familyId, requestId, "已拒绝");
      return NextResponse.json({ ok: true, status: "rejected" });
    }

    const metadata = readMetadata(invite.metadata);
    const { data: newMember, error: memberError } = await service.from("family_members").insert({
      avatar_seed: readText(metadata.avatar_seed) || joinRequest.user_id,
      display_name: joinRequest.display_name,
      family_id: context.familyId,
      relationship_role: joinRequest.relationship_role,
      role: "member",
      user_id: joinRequest.user_id
    }).select("id").single();
    if (memberError || !newMember?.id) return NextResponse.json({ detail: "创建家庭成员失败。" }, { status: 500 });

    const { data: coreSpace } = await service.from("family_spaces").select("id").eq("family_id", context.familyId).eq("space_type", "core").order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (coreSpace?.id) {
      const { error: spaceMemberError } = await service.from("space_members").insert({ access_role: "member", member_id: newMember.id, space_id: coreSpace.id });
      if (spaceMemberError) {
        await service.from("family_members").delete().eq("id", newMember.id);
        return NextResponse.json({ detail: "加入家庭空间失败，请重试。" }, { status: 500 });
      }
    }

    const inviterMemberId = invite.created_by_member_id;
    if (inviterMemberId) {
      await service.from("family_relationships").upsert([
        { family_id: context.familyId, object_member_id: newMember.id, relationship_kind: joinRequest.relationship_role, relationship_label: joinRequest.relationship_label, subject_member_id: inviterMemberId },
        { family_id: context.familyId, object_member_id: inviterMemberId, relationship_kind: reciprocalKind(joinRequest.relationship_role), relationship_label: readText(metadata.reciprocal_label) || "亲属", subject_member_id: newMember.id }
      ], { onConflict: "family_id,subject_member_id,object_member_id" });
    }

    const now = new Date().toISOString();
    await Promise.all([
      service.from("family_join_requests").update({ reviewed_at: now, reviewed_by_member_id: context.memberId, status: "approved", updated_at: now }).eq("id", requestId),
      service.from("invite_acceptances").insert({ invite_id: invite.id, membership_id: newMember.id, user_id: joinRequest.user_id }),
      service.from("invites").update({ status: "expired", used_count: 1, updated_at: now }).eq("id", invite.id)
    ]);
    await finishReviewTask(service, context.familyId, requestId, "已确认加入");
    await createRawEvent({ actorMemberId: context.memberId, actorName: null, familyId: context.familyId, rawPayload: { invite_id: invite.id, join_request_id: requestId, membership_id: newMember.id }, rawText: "确认家庭成员加入", serverMetadata: { event_type: "family.join_approved" }, sourceType: "automation.action" });
    return NextResponse.json({ memberId: newMember.id, ok: true, status: "approved" });
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

async function finishReviewTask(service: any, familyId: string, requestId: string, outcome: string) {
  const { data: rows } = await service.from("family_records").select("id,metadata").eq("family_id", familyId).contains("metadata", { joinRequestId: requestId });
  await Promise.all((rows || []).map((row: { id: string; metadata: unknown }) => service.from("family_records").update({ metadata: { ...readMetadata(row.metadata), reviewOutcome: outcome, updatedAt: "刚刚" }, status: "done", updated_at: new Date().toISOString() }).eq("id", row.id)));
}

function reciprocalKind(value: string) { return value === "parent" ? "child" : value === "child" ? "parent" : value; }
function readMetadata(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function readText(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function isUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
