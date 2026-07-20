import type { FamilyMember } from "../types";
import type { FamilyRequestContext } from "./familyRequestContext";
import { readFamilyMembersWithOverrides } from "./memberOverrides";
import { createServiceSupabaseClient } from "./supabaseServer";

export async function readFamilyMembersForContext(context: FamilyRequestContext): Promise<FamilyMember[]> {
  const service = createServiceSupabaseClient() as any;
  if (!service || !isUuid(context.familyId)) {
    return readFamilyMembersWithOverrides("data");
  }

  const { data, error } = await service
    .from("family_members")
    .select("id,display_name,role,relationship_role,household_roles,status,avatar_seed,color,profile_json")
    .eq("family_id", context.familyId)
    .order("created_at");
  if (error) {
    throw new Error("家庭成员读取失败。");
  }

  return (data || []).map((member: any) => ({
    avatarSeed: String(member.avatar_seed || member.id),
    color: member.color || undefined,
    displayName: String(member.display_name || "家庭成员"),
    householdRoles: Array.isArray(member.household_roles) ? member.household_roles : [],
    id: String(member.id),
    profile: member.profile_json || {},
    relationshipRole: member.relationship_role || "relative",
    role: member.role || "member",
    status: member.status || "offline"
  }));
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
