import { NextResponse } from "next/server";
import { applyLocalRelationshipPerspective } from "@/lib/relationshipPerspective";
import { FamilyRequestContextError, requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { createRawEvent } from "@/lib/server/eventStore";
import { deleteLiteMember, readLiteFamilyMembers, updateLiteMemberProfile } from "@/lib/server/liteRepository";
import { readLocalSession } from "@/lib/server/localAuth";
import { calculateMemberAge, parseMemberBirthDateInput } from "@/lib/memberProfileAge";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const members = readLiteFamilyMembers();
    const currentMember = members.find((member) => member.id === context.memberId);
    return NextResponse.json({
      backend: "sqlite",
      members: applyLocalRelationshipPerspective(members, context.memberId),
      session: { memberId: context.memberId, role: readLocalSession(request)?.role || sessionRole(currentMember?.role) }
    });
  } catch (error) {
    if (error instanceof FamilyRequestContextError) return NextResponse.json({ detail: error.message }, { status: error.status });
    return NextResponse.json({ detail: "家庭成员读取失败。" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const body = await request.json() as { age?: unknown; avatarSeed?: unknown; birthCalendar?: unknown; birthDate?: unknown; displayName?: unknown; memberId?: unknown };
    const targetMemberId = typeof body.memberId === "string" && body.memberId.trim() ? body.memberId.trim() : context.memberId;
    const avatarSeed = typeof body.avatarSeed === "string" ? body.avatarSeed.trim() : "";
    const displayName = typeof body.displayName === "string" ? body.displayName.trim().slice(0, 16) : "";
    const profilePatch = parseMemberProfilePatch(body);
    if (!avatarSeed && !displayName && !profilePatch) return NextResponse.json({ detail: "没有可保存的成员资料。" }, { status: 400 });
    const permissionError = ensureCanEditMember(request, context, targetMemberId);
    if (permissionError) return NextResponse.json({ detail: permissionError }, { status: 403 });
    const now = new Date();
    const profileEvidence = profilePatch
      ? await createRawEvent({
          actorMemberId: context.memberId,
          actorName: context.memberId,
          dataDir: "data",
          familyId: context.familyId,
          rawPayload: { profile: profilePatch, targetMemberId },
          rawText: formatMemberProfileFact(profilePatch),
          sourceType: "profile.confirmed"
        })
      : null;
    const profile = profilePatch
      ? {
          ...profilePatch,
          evidence: Object.keys(profilePatch).filter((field) => field !== "updatedAt").map((field) => ({
            confidence: 1,
            eventId: profileEvidence?.id || `profile-${targetMemberId}-${now.getTime()}`,
            field,
            text: formatMemberProfileFact(profilePatch)
          })),
          updatedAt: now.toISOString()
        }
      : undefined;
    const member = updateLiteMemberProfile({ avatarSeed, displayName, familyId: context.familyId, memberId: targetMemberId, profile });
    if (!member) return NextResponse.json({ detail: "成员资料不存在。" }, { status: 404 });
    return NextResponse.json({ member });
  } catch (error) {
    if (error instanceof FamilyRequestContextError) return NextResponse.json({ detail: error.message }, { status: error.status });
    return NextResponse.json({ detail: error instanceof Error ? error.message : "成员资料保存失败。" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const body = await request.json() as { memberId?: unknown };
    const memberId = typeof body.memberId === "string" ? body.memberId.trim() : "";
    if (!memberId) return NextResponse.json({ detail: "请选择要移除的成员。" }, { status: 400 });
    if (memberId === context.memberId) return NextResponse.json({ detail: "不能移除当前登录成员。" }, { status: 400 });
    if (memberId === "fanmili") return NextResponse.json({ detail: "家庭助手不是可移除成员。" }, { status: 400 });

    const session = readLocalSession(request);
    if (session?.role !== "admin") return NextResponse.json({ detail: "仅家庭管理员可以移除成员。" }, { status: 403 });
    const removed = deleteLiteMember(context.familyId, memberId);
    if (!removed) return NextResponse.json({ detail: "成员不存在或不能移除。" }, { status: 404 });
    return NextResponse.json({ memberId, ok: true });
  } catch (error) {
    if (error instanceof FamilyRequestContextError) return NextResponse.json({ detail: error.message }, { status: error.status });
    return NextResponse.json({ detail: error instanceof Error ? error.message : "成员移除失败。" }, { status: 500 });
  }
}

function sessionRole(value: unknown) { return value === "owner" || value === "admin" ? "admin" as const : "member" as const; }

function parseMemberProfilePatch(body: { age?: unknown; birthCalendar?: unknown; birthDate?: unknown }) {
  const birthCalendar = body.birthCalendar === "lunar" ? "lunar" as const : body.birthCalendar === "solar" ? "solar" as const : undefined;
  const rawBirthDate = typeof body.birthDate === "string" ? body.birthDate.trim() : "";
  const resolvedCalendar = birthCalendar || "solar" as const;
  const birthDate = rawBirthDate ? parseMemberBirthDateInput(rawBirthDate, resolvedCalendar) : "";
  const legacyAge = typeof body.age === "number" ? body.age : typeof body.age === "string" && body.age.trim() ? Number(body.age) : undefined;
  if (rawBirthDate && !birthDate) throw new Error("生日日期不正确。");
  const age = birthDate ? calculateMemberAge(birthDate, resolvedCalendar) : legacyAge;
  if (!birthDate && birthCalendar === undefined && age === undefined) return null;
  if (birthDate && age === undefined) throw new Error("生日不能晚于今天。");
  if (age !== undefined && (!Number.isInteger(age) || age < 0 || age > 130)) throw new Error("年龄需要是 0 到 130 的整数。");
  return { age, birthCalendar: resolvedCalendar, birthDate, updatedAt: new Date().toISOString() };
}

function formatMemberProfileFact(profile: { age?: number; birthCalendar?: "lunar" | "solar"; birthDate?: string }) {
  const details = [];
  if (profile.birthDate) details.push(`生日为${profile.birthCalendar === "lunar" ? "农历" : "公历"}${profile.birthDate}`);
  if (profile.age !== undefined) details.push(`年龄为${profile.age}岁`);
  return details.join("，") || "成员资料已更新";
}

function ensureCanEditMember(request: Request, context: { familyId: string; memberId: string; userId: string }, targetMemberId: string) {
  if (targetMemberId === context.memberId) return "";
  return readLocalSession(request)?.role === "admin" ? "" : "仅家庭管理员可以修改其他成员资料。";
}
