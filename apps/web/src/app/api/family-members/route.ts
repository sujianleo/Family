import { NextResponse } from "next/server";
import { applyLocalRelationshipPerspective, resolveRelationshipPerspective, type RelationshipEdge } from "@/lib/relationshipPerspective";
import { FamilyRequestContextError, requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { createRawEvent } from "@/lib/server/eventStore";
import { readFamilyMembersWithOverrides, removeFamilyMember, updateFamilyMemberProfile } from "@/lib/server/memberOverrides";
import { isLocalAuthConfigured, readLocalSession } from "@/lib/server/localAuth";
import { createServiceSupabaseClient } from "@/lib/server/supabaseServer";
import { calculateMemberAge, parseMemberBirthDateInput, withCalculatedMemberAge } from "@/lib/memberProfileAge";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const service = createServiceSupabaseClient() as any;
    if (!service || !isUuid(context.familyId)) {
      const members = await readFamilyMembersWithOverrides("data");
      return NextResponse.json({ members: applyLocalRelationshipPerspective(members, context.memberId) });
    }
    const [{ data: members, error }, { data: relationships }, { data: family }] = await Promise.all([
      service.from("family_members").select("id,display_name,role,relationship_role,household_roles,status,avatar_seed,color,profile_json").eq("family_id", context.familyId).order("created_at"),
      service.from("family_relationships").select("subject_member_id,object_member_id,relationship_kind,relationship_label").eq("family_id", context.familyId),
      service.from("families").select("created_by").eq("id", context.familyId).maybeSingle()
    ]);
    if (error) return NextResponse.json({ detail: "家庭成员读取失败。" }, { status: 500 });
    const normalizedMembers = (members || []).map((member: any) => ({
        avatarSeed: member.avatar_seed,
        color: member.color || undefined,
        displayName: member.display_name,
        householdRoles: member.household_roles || [],
        id: member.id,
        profile: withCalculatedMemberAge(member.profile_json || {}) || {},
        relationshipRole: member.relationship_role || "relative",
        role: member.role,
        status: member.status
      }));
    const ownerMember = family?.created_by ? await service.from("family_members").select("id").eq("family_id", context.familyId).eq("user_id", family.created_by).maybeSingle() : { data: null };
    const explicitEdges: RelationshipEdge[] = (relationships || []).map((item: any) => ({ objectMemberId: item.object_member_id, relationshipKind: item.relationship_kind, relationshipLabel: item.relationship_label, subjectMemberId: item.subject_member_id }));
    const legacyEdges = ownerMember.data?.id ? buildLegacyOwnerEdges(normalizedMembers, ownerMember.data.id, explicitEdges) : [];
    return NextResponse.json({ members: resolveRelationshipPerspective(normalizedMembers, context.memberId, [...explicitEdges, ...legacyEdges]) });
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
    const service = createServiceSupabaseClient() as any;
    const permissionError = await ensureCanEditMember(request, context, targetMemberId, service);
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
    if (!service || !isUuid(context.familyId)) {
      const member = await updateFamilyMemberProfile("data", targetMemberId, { avatarSeed, displayName, profile });
      return NextResponse.json({ member: { ...member, profile } });
    }
    const updates: Record<string, unknown> = {};
    if (avatarSeed) updates.avatar_seed = avatarSeed;
    if (displayName) updates.display_name = displayName;
    if (profile) {
      const { data: existing } = await service.from("family_members").select("profile_json").eq("family_id", context.familyId).eq("id", targetMemberId).maybeSingle();
      updates.profile_json = { ...(existing?.profile_json || {}), ...profile };
    }
    const { data, error } = await service
      .from("family_members")
      .update(updates)
      .eq("family_id", context.familyId)
      .eq("id", targetMemberId)
      .select("id,avatar_seed,display_name,profile_json")
      .single();
    if (error) return NextResponse.json({ detail: "成员资料保存失败。" }, { status: 500 });
    return NextResponse.json({ member: { avatarSeed: data.avatar_seed, displayName: data.display_name, memberId: data.id, profile: data.profile_json || {} } });
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

    if (isLocalAuthConfigured()) {
      const session = readLocalSession(request);
      if (session?.role !== "admin") return NextResponse.json({ detail: "仅家庭管理员可以移除成员。" }, { status: 403 });
      await removeFamilyMember("data", memberId);
      return NextResponse.json({ memberId, ok: true });
    }

    const service = createServiceSupabaseClient() as any;
    if (!service || !isUuid(context.familyId)) return NextResponse.json({ detail: "仅家庭管理员可以移除成员。" }, { status: 403 });
    const { data: family } = await service.from("families").select("created_by").eq("id", context.familyId).maybeSingle();
    if (!family || family.created_by !== context.userId) return NextResponse.json({ detail: "仅家庭管理员可以移除成员。" }, { status: 403 });
    const { data, error } = await service.from("family_members").delete().eq("family_id", context.familyId).eq("id", memberId).select("id").maybeSingle();
    if (error || !data?.id) return NextResponse.json({ detail: "成员移除失败。" }, { status: 500 });
    return NextResponse.json({ memberId: data.id, ok: true });
  } catch (error) {
    if (error instanceof FamilyRequestContextError) return NextResponse.json({ detail: error.message }, { status: error.status });
    return NextResponse.json({ detail: error instanceof Error ? error.message : "成员移除失败。" }, { status: 500 });
  }
}

function isUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }

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

async function ensureCanEditMember(request: Request, context: { familyId: string; memberId: string; userId: string }, targetMemberId: string, service: any) {
  if (targetMemberId === context.memberId) return "";
  if (isLocalAuthConfigured()) return readLocalSession(request)?.role === "admin" ? "" : "仅家庭管理员可以修改其他成员资料。";
  if (!service || !isUuid(context.familyId)) return "";
  const { data: family } = await service.from("families").select("created_by").eq("id", context.familyId).maybeSingle();
  return family?.created_by === context.userId ? "" : "仅家庭管理员可以修改其他成员资料。";
}

function buildLegacyOwnerEdges(members: any[], ownerId: string, explicitEdges: RelationshipEdge[]) {
  const keyed = new Set(explicitEdges.map((edge) => `${edge.subjectMemberId}:${edge.objectMemberId}`));
  const edges: RelationshipEdge[] = [];
  for (const member of members) {
    if (member.id === ownerId || keyed.has(`${ownerId}:${member.id}`)) continue;
    const kind = legacyKind(member.relationshipRole, member.displayName);
    if (!kind) continue;
    const label = legacyLabel(kind, member.displayName);
    edges.push({ objectMemberId: member.id, relationshipKind: kind, relationshipLabel: label, subjectMemberId: ownerId });
    if (!keyed.has(`${member.id}:${ownerId}`)) edges.push({ objectMemberId: ownerId, relationshipKind: reciprocalKind(kind), relationshipLabel: reciprocalLabel(kind), subjectMemberId: member.id });
  }
  return edges;
}

function legacyKind(role: string, name: string) { if (role === "parent" || role === "child" || role === "spouse") return role; return /(姐|哥|妹|弟)/.test(name) ? "sibling" : ""; }
function legacyLabel(kind: string, name: string) { if (kind === "parent") return /(妈|母)/.test(name) ? "妈妈" : /(爸|父)/.test(name) ? "爸爸" : "父母"; if (kind === "child") return /(女|闺)/.test(name) ? "女儿" : /(儿|子)/.test(name) ? "儿子" : "孩子"; if (kind === "spouse") return "配偶"; return name; }
function reciprocalKind(kind: string) { return kind === "parent" ? "child" : kind === "child" ? "parent" : kind; }
function reciprocalLabel(kind: string) { return kind === "parent" ? "孩子" : kind === "child" ? "父母" : kind === "spouse" ? "配偶" : "兄弟姐妹"; }
