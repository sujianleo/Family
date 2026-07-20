import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createRawEvent } from "./eventStore";
import { createServiceSupabaseClient } from "./supabaseServer";
import { isLocalAuthConfigured, localAuthContext, readLocalSession } from "./localAuth";
import { createRecordNotifications } from "./notificationStore";
import type { Database, Json } from "../types";

export type InviteType = "family" | "group";
export type InviteStatus = "active" | "expired" | "revoked";

export class InviteAccessError extends Error {
  constructor(message: string, readonly status: 400 | 401 | 403 | 404 | 409 | 410 | 429 | 503 = 400) {
    super(message);
  }
}

export async function requireInviteUser(request: Request) {
  const localSession = isLocalAuthConfigured() ? readLocalSession(request) : null;
  if (localSession) return { ...localAuthContext(localSession), phone: "" };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new InviteAccessError("账号服务尚未配置。", 503);
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) throw new InviteAccessError("请先登录或创建账号，再加入。", 401);
  const authClient = createClient<Database>(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) throw new InviteAccessError("登录会话无效或已过期。", 401);
  return { familyId: "", memberId: "", phone: data.user.phone || "", userId: data.user.id };
}

export function createInviteCode() {
  return String(randomInt(0, 10_000)).padStart(4, "0");
}

export function hashInviteCode(inviteId: string, code: string) {
  return createHmac("sha256", inviteSecret()).update(`${inviteId}:${code}`).digest("base64url");
}

export function verifyInviteCode(inviteId: string, code: string, expectedHash: string) {
  if (!/^\d{4}$/.test(code)) return false;
  const actual = Buffer.from(hashInviteCode(inviteId, code));
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function readInvitePreview(inviteId: string, code?: string) {
  assertInviteId(inviteId);
  const service = requireServiceClient();
  const { data, error } = await service.from("invites").select("*").eq("id", inviteId).maybeSingle();
  if (error) throw new InviteAccessError("暂时无法读取邀请。", 503);
  if (!data) throw new InviteAccessError("邀请不存在。", 404);
  const status = effectiveStatus(data.status, data.expires_at, data.used_count, data.max_use);
  if (status === "expired" && data.status === "active") {
    await service.from("invites").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", inviteId).eq("status", "active");
  }
  const verified = Boolean(code && verifyInviteCode(inviteId, code, data.code_hash));
  const metadata = readMetadata(data.metadata);
  return {
    expiresAt: data.expires_at,
    id: data.id,
    maxUse: data.max_use,
    remainingUses: Math.max(0, data.max_use - data.used_count),
    status,
    type: data.type,
    verified,
    ...(verified ? {
      familyName: readText(metadata.family_name),
      inviterName: readText(metadata.inviter_name),
      targetName: readText(metadata.target_name),
      title: readText(metadata.title),
      relationshipLabel: readText(metadata.relationship_label),
      avatarSeed: readText(metadata.avatar_seed)
    } : {})
  };
}

export async function createInvite(input: {
  actorMemberId: string;
  actorName?: string;
  familyId: string;
  requestOrigin: string;
  targetId?: string;
  targetName?: string;
  avatarSeed?: string;
  relationshipLabel?: string;
  relationshipRole?: "parent" | "child" | "spouse" | "relative";
  type: InviteType;
  maxUse?: number;
}) {
  const service = requireServiceClient();
  const actor = await resolveActor(service, input.actorMemberId, input.familyId);
  const inviteId = randomUUID();
  const code = createInviteCode();
  const maxUse = input.type === "family" ? 1 : clampUses(input.maxUse);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  const target = await resolveTarget(service, input.type, input.familyId, input.targetId, actor.memberId);
  const metadata: Json = {
    entry_path: target.entryPath,
    family_name: target.familyName,
    inviter_name: input.actorName || actor.displayName,
    target_name: input.targetName?.trim().slice(0, 40) || "",
    avatar_seed: input.avatarSeed?.trim().slice(0, 80) || "",
    relationship_label: input.relationshipLabel?.trim().slice(0, 24) || "",
    relationship_role: input.relationshipRole || "relative",
    reciprocal_label: reciprocalRelationshipLabel(input.relationshipLabel || "", actor.memberId),
    title: target.title
  };
  const { error } = await service.from("invites").insert({
    code_hash: hashInviteCode(inviteId, code),
    created_by: actor.userId,
    created_by_member_id: actor.memberId,
    expires_at: expiresAt,
    family_id: input.familyId,
    group_id: input.type === "group" ? target.groupId : null,
    id: inviteId,
    max_use: maxUse,
    metadata,
    type: input.type
  });
  if (error) throw new InviteAccessError("邀请创建失败，请稍后再试。", 503);
  await createRawEvent({
    actorMemberId: actor.memberId,
    actorName: input.actorName || actor.displayName,
    familyId: input.familyId,
    rawPayload: { invite_id: inviteId, invite_type: input.type, group_id: target.groupId, max_use: maxUse },
    rawText: "创建邀请",
    serverMetadata: { event_type: "invite_created" },
    sourceType: "automation.action"
  });
  return {
    code,
    expiresAt,
    id: inviteId,
    link: `${input.requestOrigin.replace(/\/$/, "")}/invite/${inviteId}`,
    maxUse,
    type: input.type
  };
}

export async function acceptInvite(input: { avatarUrl?: string; code: string; displayName: string; inviteId: string; request: Request }) {
  assertInviteId(input.inviteId);
  const identity = await requireInviteUser(input.request);
  const service = requireServiceClient();
  const { data: invite, error } = await service.from("invites").select("*").eq("id", input.inviteId).maybeSingle();
  if (error) throw new InviteAccessError("暂时无法验证邀请。", 503);
  if (!invite) throw new InviteAccessError("邀请不存在。", 404);
  assertUsable(invite.status, invite.expires_at, invite.used_count, invite.max_use);
  if (!verifyInviteCode(input.inviteId, input.code, invite.code_hash)) throw new InviteAccessError("验证码不正确。", 403);
  const displayName = input.displayName.trim().slice(0, 40);
  if (!displayName) throw new InviteAccessError("请填写你的称呼。", 400);
  if (invite.type === "family") {
    return submitFamilyJoinRequest({ avatarUrl: input.avatarUrl, displayName, identity, invite, inviteId: input.inviteId });
  }
  const { data, error: rpcError } = await service.rpc("accept_invite_membership", {
    target_avatar_url: input.avatarUrl?.trim() || null,
    target_display_name: displayName,
    target_invite_id: input.inviteId,
    target_user_id: identity.userId
  });
  if (rpcError) throw mapMembershipError(rpcError.message);
  const result = readMetadata(data);
  const inviteMetadata = readMetadata(invite.metadata);
  await createRawEvent({
    actorMemberId: null,
    actorName: displayName,
    familyId: readText(result.family_id),
    rawPayload: { group_id: result.group_id || null, invite_id: input.inviteId, membership_id: result.membership_id, user_id: identity.userId },
    rawText: "接受邀请",
    serverMetadata: { event_type: "invite.accepted" },
    sourceType: "automation.action"
  });
  return { ...result, entry_path: readText(inviteMetadata.entry_path) || "/" };
}

async function submitFamilyJoinRequest(input: {
  avatarUrl?: string;
  displayName: string;
  identity: { phone?: string; userId: string };
  invite: any;
  inviteId: string;
}) {
  const service = requireServiceClient() as any;
  const metadata = readMetadata(input.invite.metadata);
  const { data: existingMember } = await service.from("family_members").select("id").eq("family_id", input.invite.family_id).eq("user_id", input.identity.userId).maybeSingle();
  if (existingMember) throw new InviteAccessError("你已经是这个家庭的成员。", 409);
  const { data: inviteClaim } = await service.from("family_join_requests").select("id,user_id,status").eq("invite_id", input.inviteId).maybeSingle();
  if (inviteClaim && inviteClaim.user_id !== input.identity.userId) throw new InviteAccessError("这个邀请已经被使用。", 409);
  const { data: existingRequest } = await service.from("family_join_requests").select("id,status").eq("family_id", input.invite.family_id).eq("user_id", input.identity.userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (existingRequest?.status === "pending") return { entry_path: "/", join_request_id: existingRequest.id, status: "pending_admin_approval" };
  if (existingRequest?.status === "approved") throw new InviteAccessError("这个账号已经加入家庭。", 409);

  await service.from("users").upsert({ id: input.identity.userId, display_name: input.displayName, avatar_url: input.avatarUrl?.trim() || null, updated_at: new Date().toISOString() }, { onConflict: "id" });
  const requestId = randomUUID();
  const relationshipLabel = readText(metadata.relationship_label) || "其他亲属";
  const relationshipRole = readRelationshipRole(metadata.relationship_role);
  const { error } = await service.from("family_join_requests").insert({
    avatar_url: input.avatarUrl?.trim() || null,
    display_name: input.displayName,
    family_id: input.invite.family_id,
    id: requestId,
    invite_id: input.inviteId,
    phone: input.identity.phone || "",
    relationship_label: relationshipLabel,
    relationship_role: relationshipRole,
    user_id: input.identity.userId
  });
  if (error) throw new InviteAccessError("加入申请提交失败，请稍后再试。", 503);

  const [{ data: family }, { data: memberRows }] = await Promise.all([
    service.from("families").select("created_by").eq("id", input.invite.family_id).maybeSingle(),
    service.from("family_members").select("id,user_id,role").eq("family_id", input.invite.family_id)
  ]);
  const adminIds = (memberRows || []).filter((item: { role: string; user_id: string }) => item.role === "owner" || item.user_id === family?.created_by).map((item: { id: string }) => item.id);
  if (!adminIds.length) throw new InviteAccessError("家庭管理员账号尚未绑定。", 503);
  const recordId = randomUUID();
  const record = {
    assignmentReason: "家庭成员加入申请",
    assignmentStatus: "assigned",
    assigneeMemberIds: adminIds,
    audience: "core",
    id: recordId,
    inviteId: input.inviteId,
    joinRequestId: requestId,
    kind: "task",
    ownerName: "成员申请",
    relationshipLabel,
    status: "todo",
    summary: `${input.displayName} 申请以“${relationshipLabel}”身份加入家庭${input.identity.phone ? `（${maskPhone(input.identity.phone)}）` : ""}。`,
    tags: ["成员申请", "待管理员确认"],
    taskActionType: "approval",
    title: `确认 ${input.displayName} 加入家庭`,
    updatedAt: "刚刚"
  };
  await service.from("family_records").insert({
    assignee_member_ids: adminIds,
    assignment_reason: record.assignmentReason,
    assignment_status: "assigned",
    audience: "core",
    family_id: input.invite.family_id,
    id: recordId,
    kind: "task",
    metadata: record,
    status: "todo",
    summary: record.summary,
    tags: record.tags,
    title: record.title
  });
  await createRecordNotifications({ familyId: input.invite.family_id, memberId: `applicant:${input.identity.userId}` }, { ...record, chatMembers: [], chatMessages: [] });
  await createRawEvent({ actorMemberId: null, actorName: input.displayName, familyId: input.invite.family_id, rawPayload: { invite_id: input.inviteId, join_request_id: requestId, user_id: input.identity.userId }, rawText: "提交家庭加入申请", serverMetadata: { event_type: "family.join_requested" }, sourceType: "automation.action" });
  return { entry_path: "/", join_request_id: requestId, status: "pending_admin_approval" };
}

function readRelationshipRole(value: unknown): "parent" | "child" | "spouse" | "relative" {
  return value === "parent" || value === "child" || value === "spouse" ? value : "relative";
}

function reciprocalRelationshipLabel(label: string, actorMemberId: string) {
  if (["妈妈", "爸爸", "奶奶", "爷爷", "外婆", "外公"].includes(label)) return ["me", "son", "dad"].includes(actorMemberId) ? "儿子" : ["wife", "daughter", "mom", "sister"].includes(actorMemberId) ? "女儿" : "孩子";
  if (["女儿", "儿子"].includes(label)) return ["me", "dad", "son"].includes(actorMemberId) ? "爸爸" : ["wife", "mom", "daughter", "sister"].includes(actorMemberId) ? "妈妈" : "父母";
  if (label === "配偶") return "配偶";
  const siblingReverse: Record<string, string> = { 姐姐: "弟弟/妹妹", 哥哥: "弟弟/妹妹", 妹妹: "哥哥/姐姐", 弟弟: "哥哥/姐姐" };
  return siblingReverse[label] || "亲属";
}

function maskPhone(phone: string) {
  return phone.replace(/(\d{3})\d+(\d{4})$/, "$1****$2");
}

export async function revokeInvite(input: { actorMemberId: string; actorName?: string; familyId: string; inviteId: string }) {
  const service = requireServiceClient();
  const actor = await resolveActor(service, input.actorMemberId, input.familyId);
  const { data: invite, error } = await service.from("invites").select("id, family_id, status, created_by").eq("id", input.inviteId).maybeSingle();
  if (error) throw new InviteAccessError("暂时无法读取邀请。", 503);
  if (!invite || invite.family_id !== input.familyId) throw new InviteAccessError("邀请不存在。", 404);
  if (invite.created_by !== actor.userId && !actor.isOwner) throw new InviteAccessError("只有邀请人或家庭创建者可以撤销。", 403);
  if (invite.status === "revoked") return { id: invite.id, status: "revoked" as const };
  const { error: updateError } = await service.from("invites").update({ status: "revoked", updated_at: new Date().toISOString() }).eq("id", invite.id).eq("family_id", input.familyId);
  if (updateError) throw new InviteAccessError("撤销邀请失败。", 503);
  await createRawEvent({ actorMemberId: actor.memberId, actorName: input.actorName || actor.displayName, familyId: input.familyId, rawPayload: { invite_id: invite.id }, rawText: "撤销邀请", serverMetadata: { event_type: "invite_revoked" }, sourceType: "automation.action" });
  return { id: invite.id, status: "revoked" as const };
}

function requireServiceClient() {
  const client = createServiceSupabaseClient();
  if (!client) throw new InviteAccessError("邀请服务尚未配置。", 503);
  return client;
}

async function resolveActor(service: NonNullable<ReturnType<typeof createServiceSupabaseClient>>, memberId: string, familyId: string) {
  const [{ data, error }, { data: family }] = await Promise.all([
    service.from("family_members").select("id, user_id, display_name, family_id, role").eq("id", memberId).eq("family_id", familyId).maybeSingle(),
    service.from("families").select("created_by").eq("id", familyId).maybeSingle()
  ]);
  if (error) throw new InviteAccessError("无法确认邀请人身份。", 503);
  if (!data?.id || !data.user_id) throw new InviteAccessError("只有已绑定账号的家庭成员可以邀请。", 403);
  return { displayName: data.display_name, isOwner: data.role === "owner" || family?.created_by === data.user_id, memberId: data.id, userId: data.user_id };
}

async function resolveTarget(service: NonNullable<ReturnType<typeof createServiceSupabaseClient>>, type: InviteType, familyId: string, targetId: string | undefined, actorMemberId: string) {
  const { data: family } = await service.from("families").select("name").eq("id", familyId).maybeSingle();
  if (!family) throw new InviteAccessError("家庭不存在。", 404);
  if (type === "family") return { entryPath: "/", familyName: family.name, groupId: null, title: "加入家庭" };
  if (!targetId) throw new InviteAccessError("请选择要邀请加入的群聊。", 400);
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetId);
  const direct = isUuid
    ? await service.from("family_records").select("id, family_id, title, tags, metadata, created_by_member_id").eq("id", targetId).eq("family_id", familyId).maybeSingle()
    : { data: null };
  const fallback = direct.data
    ? direct
    : await service.from("family_records").select("id, family_id, title, tags, metadata, created_by_member_id").eq("family_id", familyId).contains("metadata", { recordId: targetId }).maybeSingle();
  const group = fallback.data;
  if (!group || !group.tags.some((tag: string) => tag === "群组" || tag === "群聊")) throw new InviteAccessError("群聊不存在。", 404);
  const groupMetadata = readMetadata(group.metadata);
  const chatMembers = Array.isArray(groupMetadata.chatMembers) ? groupMetadata.chatMembers.map(String) : [];
  if (group.created_by_member_id !== actorMemberId && !chatMembers.includes(actorMemberId)) throw new InviteAccessError("只有当前群聊成员可以邀请朋友。", 403);
  const legacyLink = readText(groupMetadata.inviteLink);
  let entryPath = "/";
  try { entryPath = legacyLink ? new URL(legacyLink).pathname : "/"; } catch { entryPath = "/"; }
  return { entryPath, familyName: family.name, groupId: group.id, title: group.title };
}

function effectiveStatus(status: InviteStatus, expiresAt: string, usedCount: number, maxUse: number): InviteStatus {
  if (status === "revoked") return "revoked";
  return new Date(expiresAt).getTime() <= Date.now() || usedCount >= maxUse ? "expired" : status;
}
function assertUsable(status: InviteStatus, expiresAt: string, usedCount: number, maxUse: number) {
  const current = effectiveStatus(status, expiresAt, usedCount, maxUse);
  if (current === "revoked") throw new InviteAccessError("邀请已撤销。", 410);
  if (current === "expired") throw new InviteAccessError("邀请已过期或使用次数已满。", 410);
}
function assertInviteId(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new InviteAccessError("邀请不存在。", 404);
}
function clampUses(value?: number) { return Math.min(100, Math.max(1, Number.isFinite(value) ? Math.floor(value as number) : 10)); }
function inviteSecret() {
  const secret = process.env.INVITE_CODE_SECRET || process.env.FAMILY_APP_CONFIRMATION_SECRET || process.env.GUEST_CHAT_CODE_SECRET;
  if (!secret) throw new InviteAccessError("邀请验证码服务尚未配置。", 503);
  return secret;
}
function readText(value: unknown) { return typeof value === "string" ? value : ""; }
function readMetadata(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }
function mapMembershipError(message: string) {
  if (/已经|重复/.test(message)) return new InviteAccessError(message, 409);
  if (/过期|撤销|次数/.test(message)) return new InviteAccessError(message, 410);
  return new InviteAccessError("加入失败，请稍后再试。", 503);
}
