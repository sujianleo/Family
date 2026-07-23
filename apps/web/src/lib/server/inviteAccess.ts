import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { normalizePhoneNumber } from "../phoneAuth";
import type { FamilyRecord } from "../types";
import { createPasswordHash, isLocalAuthConfigured, localAuthContext, readLocalSession } from "./localAuth";
import {
  createLiteInvite,
  createLiteJoinRequest,
  expireLiteInvite,
  readLiteInvite,
  revokeLiteInvite
} from "./liteInviteRepository";
import {
  readLiteAccounts,
  readLiteInstallation,
  saveLiteFamilyRecord
} from "./liteRepository";

export type InviteType = "family" | "group";
export type InviteStatus = "active" | "expired" | "revoked";

export class InviteAccessError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 403 | 404 | 409 | 410 | 429 | 503 = 400
  ) {
    super(message);
  }
}

export async function requireInviteUser(request: Request) {
  const session = isLocalAuthConfigured() ? readLocalSession(request) : null;
  if (!session) throw new InviteAccessError("请先登录家庭账号。", 401);
  return { ...localAuthContext(session), phone: "" };
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
  const invite = readLiteInvite(inviteId);
  if (!invite) throw new InviteAccessError("邀请不存在。", 404);
  const status = effectiveStatus(invite.status, invite.expiresAt, invite.usedCount, invite.maxUse);
  if (status === "expired" && invite.status === "active") expireLiteInvite(invite.id);
  const verified = Boolean(code && verifyInviteCode(invite.id, code, invite.codeHash));
  return {
    expiresAt: invite.expiresAt,
    id: invite.id,
    maxUse: invite.maxUse,
    remainingUses: Math.max(0, invite.maxUse - invite.usedCount),
    status,
    type: invite.type,
    verified,
    ...(verified ? {
      avatarSeed: readText(invite.metadata.avatar_seed),
      familyName: readText(invite.metadata.family_name),
      inviterName: readText(invite.metadata.inviter_name),
      relationshipLabel: readText(invite.metadata.relationship_label),
      targetName: readText(invite.metadata.target_name),
      title: readText(invite.metadata.title)
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
  if (input.type !== "family") throw new InviteAccessError("当前只支持邀请家庭成员。", 400);
  const actor = readLiteAccounts().find(
    (account) => account.memberId === input.actorMemberId && account.familyId === input.familyId
  );
  if (!actor) throw new InviteAccessError("只有家庭成员可以邀请。", 403);
  const installation = readLiteInstallation();
  if (!installation || installation.familyId !== input.familyId) {
    throw new InviteAccessError("家庭不存在。", 404);
  }
  const inviteId = randomUUID();
  const code = createInviteCode();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  createLiteInvite({
    codeHash: hashInviteCode(inviteId, code),
    createdByMemberId: actor.memberId,
    expiresAt,
    familyId: input.familyId,
    id: inviteId,
    maxUse: 1,
    metadata: {
      avatar_seed: input.avatarSeed?.trim().slice(0, 80) || "",
      entry_path: "/",
      family_name: installation.familyName,
      inviter_name: input.actorName?.trim() || actor.displayName,
      reciprocal_label: reciprocalRelationshipLabel(input.relationshipLabel || "", actor.memberId),
      relationship_label: input.relationshipLabel?.trim().slice(0, 24) || "其他亲属",
      relationship_role: input.relationshipRole || "relative",
      target_name: input.targetName?.trim().slice(0, 40) || "",
      title: "加入家庭"
    },
    status: "active",
    type: "family"
  });
  return {
    code,
    expiresAt,
    id: inviteId,
    link: `${input.requestOrigin.replace(/\/$/, "")}/invite/${inviteId}`,
    maxUse: 1,
    type: "family" as const
  };
}

export async function acceptInvite(input: {
  avatarSeed?: string;
  avatarUrl?: string;
  code: string;
  displayName: string;
  inviteId: string;
  password?: string;
  phone?: string;
  request: Request;
}) {
  assertInviteId(input.inviteId);
  const invite = readLiteInvite(input.inviteId);
  if (!invite) throw new InviteAccessError("邀请不存在。", 404);
  assertUsable(invite.status, invite.expiresAt, invite.usedCount, invite.maxUse);
  if (invite.type !== "family") throw new InviteAccessError("当前只支持家庭成员邀请。", 400);
  if (!verifyInviteCode(input.inviteId, input.code, invite.codeHash)) {
    throw new InviteAccessError("验证码不正确。", 403);
  }

  const displayName = input.displayName.trim().slice(0, 40);
  const phone = normalizePhoneNumber(input.phone || "");
  const password = input.password || "";
  if (!displayName) throw new InviteAccessError("请填写你在这里的称呼。", 400);
  if (!phone) throw new InviteAccessError("请输入正确的手机号。", 400);
  if (password.length < 8 || password.length > 72) {
    throw new InviteAccessError("密码需为 8–72 个字符。", 400);
  }

  const metadata = invite.metadata;
  let requestId = "";
  try {
    requestId = createLiteJoinRequest({
      avatarSeed: input.avatarSeed?.trim().slice(0, 80) || readText(metadata.avatar_seed),
      displayName,
      familyId: invite.familyId,
      inviteId: invite.id,
      passwordHash: await createPasswordHash(password),
      phone,
      relationshipLabel: readText(metadata.relationship_label) || "其他亲属",
      relationshipRole: readRelationshipRole(metadata.relationship_role)
    });
  } catch (error) {
    if (error instanceof Error && error.message === "PHONE_ALREADY_REGISTERED") {
      throw new InviteAccessError("这个手机号已经注册，请直接登录。", 409);
    }
    if (error instanceof Error && error.message === "PHONE_ALREADY_PENDING") {
      throw new InviteAccessError("这个手机号已有待审核的申请。", 409);
    }
    if (error instanceof Error && error.message === "INVITE_ALREADY_CLAIMED") {
      throw new InviteAccessError("这个邀请已经被使用。", 409);
    }
    throw error;
  }

  const adminIds = readLiteAccounts()
    .filter((account) => account.familyId === invite.familyId && account.role === "admin")
    .map((account) => account.memberId);
  if (!adminIds.length) throw new InviteAccessError("家庭管理员账号尚未绑定。", 503);
  const relationshipLabel = readText(metadata.relationship_label) || "其他亲属";
  const record: FamilyRecord = {
    assignmentReason: "家庭成员加入申请",
    assignmentStatus: "assigned",
    assigneeMemberIds: adminIds,
    audience: "core",
    id: randomUUID(),
    inviteId: invite.id,
    joinRequestId: requestId,
    kind: "task",
    ownerName: "成员申请",
    relationshipLabel,
    status: "todo",
    summary: `${displayName} 申请以“${relationshipLabel}”身份加入家庭（${maskPhone(phone)}）。`,
    tags: ["成员申请", "待管理员确认"],
    taskActionType: "approval",
    title: `确认 ${displayName} 加入家庭`,
    updatedAt: "刚刚"
  };
  saveLiteFamilyRecord(invite.familyId, invite.createdByMemberId, record);
  return { entry_path: "/", join_request_id: requestId, status: "pending_admin_approval" };
}

export async function revokeInvite(input: {
  actorMemberId: string;
  actorName?: string;
  familyId: string;
  inviteId: string;
}) {
  const actor = readLiteAccounts().find(
    (account) => account.memberId === input.actorMemberId && account.familyId === input.familyId
  );
  if (!actor) throw new InviteAccessError("只有家庭成员可以撤销邀请。", 403);
  const invite = readLiteInvite(input.inviteId);
  if (!invite || invite.familyId !== input.familyId) throw new InviteAccessError("邀请不存在。", 404);
  if (invite.createdByMemberId !== actor.memberId && actor.role !== "admin") {
    throw new InviteAccessError("只有邀请人或家庭管理员可以撤销。", 403);
  }
  if (invite.status !== "revoked") revokeLiteInvite(invite.id, input.familyId);
  return { id: invite.id, status: "revoked" as const };
}

function effectiveStatus(
  status: InviteStatus,
  expiresAt: string,
  usedCount: number,
  maxUse: number
): InviteStatus {
  if (status === "revoked") return "revoked";
  return new Date(expiresAt).getTime() <= Date.now() || usedCount >= maxUse ? "expired" : status;
}

function assertUsable(status: InviteStatus, expiresAt: string, usedCount: number, maxUse: number) {
  const current = effectiveStatus(status, expiresAt, usedCount, maxUse);
  if (current === "revoked") throw new InviteAccessError("邀请已撤销。", 410);
  if (current === "expired") throw new InviteAccessError("邀请已过期或使用次数已满。", 410);
}

function assertInviteId(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new InviteAccessError("邀请不存在。", 404);
  }
}

function inviteSecret() {
  const secret = process.env.INVITE_CODE_SECRET
    || process.env.FAMILY_APP_CONFIRMATION_SECRET
    || process.env.GUEST_CHAT_CODE_SECRET
    || process.env.FAMILY_APP_LOCAL_AUTH_SESSION_SECRET;
  if (!secret) throw new InviteAccessError("邀请验证码服务尚未配置。", 503);
  return secret;
}

function readRelationshipRole(value: unknown): "parent" | "child" | "spouse" | "relative" {
  return value === "parent" || value === "child" || value === "spouse" ? value : "relative";
}

function reciprocalRelationshipLabel(label: string, actorMemberId: string) {
  if (["妈妈", "爸爸", "奶奶", "爷爷", "外婆", "外公"].includes(label)) {
    if (["me", "son", "dad"].includes(actorMemberId)) return "儿子";
    if (["wife", "daughter", "mom", "sister"].includes(actorMemberId)) return "女儿";
    return "孩子";
  }
  if (["女儿", "儿子"].includes(label)) {
    if (["me", "dad", "son"].includes(actorMemberId)) return "爸爸";
    if (["wife", "mom", "daughter", "sister"].includes(actorMemberId)) return "妈妈";
    return "父母";
  }
  if (label === "配偶") return "配偶";
  const siblingReverse: Record<string, string> = {
    姐姐: "弟弟/妹妹",
    哥哥: "弟弟/妹妹",
    妹妹: "哥哥/姐姐",
    弟弟: "哥哥/姐姐"
  };
  return siblingReverse[label] || "亲属";
}

function maskPhone(phone: string) {
  return phone.replace(/(\d{3})\d+(\d{4})$/, "$1****$2");
}

function readText(value: unknown) {
  return typeof value === "string" ? value : "";
}
