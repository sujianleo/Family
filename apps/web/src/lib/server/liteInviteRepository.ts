import { randomUUID } from "node:crypto";
import { getLiteDatabase } from "./liteDatabase";
import { readLiteAccounts } from "./liteRepository";

export type LiteStoredInvite = {
  codeHash: string;
  createdByMemberId: string;
  expiresAt: string;
  familyId: string;
  id: string;
  maxUse: number;
  metadata: Record<string, unknown>;
  status: "active" | "expired" | "revoked";
  type: "family" | "group";
  usedCount: number;
};

export type LiteJoinRequest = {
  avatarSeed: string;
  displayName: string;
  familyId: string;
  id: string;
  inviteId: string;
  passwordHash: string;
  phone: string;
  relationshipLabel: string;
  relationshipRole: "parent" | "child" | "spouse" | "relative";
  status: "pending" | "approved" | "rejected";
};

type InviteRow = {
  code_hash: string;
  created_by_member_id: string;
  expires_at: string;
  family_id: string;
  id: string;
  max_use: number;
  metadata_json: string;
  status: string;
  type: string;
  used_count: number;
};

type JoinRequestRow = {
  avatar_seed: string;
  display_name: string;
  family_id: string;
  id: string;
  invite_id: string;
  password_hash: string;
  phone: string;
  relationship_label: string;
  relationship_role: string;
  status: string;
};

export function createLiteInvite(input: Omit<LiteStoredInvite, "usedCount">) {
  const now = new Date().toISOString();
  getLiteDatabase().prepare(`
    insert into lite_invites(
      id, family_id, type, code_hash, status, max_use, used_count,
      created_by_member_id, expires_at, metadata_json, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.familyId,
    input.type,
    input.codeHash,
    input.status,
    input.maxUse,
    input.createdByMemberId,
    input.expiresAt,
    JSON.stringify(input.metadata),
    now,
    now
  );
}

export function readLiteInvite(id: string): LiteStoredInvite | null {
  const row = getLiteDatabase().prepare("select * from lite_invites where id = ?").get(id) as InviteRow | undefined;
  if (!row) return null;
  let metadata: Record<string, unknown> = {};
  try { metadata = JSON.parse(row.metadata_json) as Record<string, unknown>; } catch { /* Keep empty metadata. */ }
  return {
    codeHash: row.code_hash,
    createdByMemberId: row.created_by_member_id,
    expiresAt: row.expires_at,
    familyId: row.family_id,
    id: row.id,
    maxUse: row.max_use,
    metadata,
    status: row.status === "revoked" ? "revoked" : row.status === "expired" ? "expired" : "active",
    type: row.type === "group" ? "group" : "family",
    usedCount: row.used_count
  };
}

export function expireLiteInvite(id: string) {
  getLiteDatabase().prepare("update lite_invites set status = 'expired', updated_at = ? where id = ? and status = 'active'")
    .run(new Date().toISOString(), id);
}

export function revokeLiteInvite(id: string, familyId: string) {
  return Number(getLiteDatabase().prepare("update lite_invites set status = 'revoked', updated_at = ? where id = ? and family_id = ?")
    .run(new Date().toISOString(), id, familyId).changes);
}

export function createLiteJoinRequest(input: Omit<LiteJoinRequest, "id" | "status">) {
  const database = getLiteDatabase();
  if (readLiteAccounts().some((account) => account.phone === input.phone)) throw new Error("PHONE_ALREADY_REGISTERED");
  const duplicate = database.prepare("select id from lite_join_requests where phone = ? and status = 'pending'").get(input.phone);
  if (duplicate) throw new Error("PHONE_ALREADY_PENDING");
  const claimed = database.prepare("select id from lite_join_requests where invite_id = ?").get(input.inviteId);
  if (claimed) throw new Error("INVITE_ALREADY_CLAIMED");
  const id = randomUUID();
  const now = new Date().toISOString();
  database.prepare(`
    insert into lite_join_requests(
      id, invite_id, family_id, display_name, phone, password_hash, avatar_seed,
      relationship_label, relationship_role, status, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(
    id,
    input.inviteId,
    input.familyId,
    input.displayName,
    input.phone,
    input.passwordHash,
    input.avatarSeed,
    input.relationshipLabel,
    input.relationshipRole,
    now,
    now
  );
  return id;
}

export function readLiteJoinRequest(id: string): LiteJoinRequest | null {
  const row = getLiteDatabase().prepare("select * from lite_join_requests where id = ?").get(id) as JoinRequestRow | undefined;
  return row ? mapJoinRequest(row) : null;
}

export function approveLiteJoinRequest(requestId: string, reviewerMemberId: string) {
  const database = getLiteDatabase();
  const request = readLiteJoinRequest(requestId);
  if (!request) throw new Error("JOIN_REQUEST_NOT_FOUND");
  if (request.status !== "pending") throw new Error("JOIN_REQUEST_REVIEWED");
  if (readLiteAccounts().some((account) => account.phone === request.phone)) throw new Error("PHONE_ALREADY_REGISTERED");
  const memberId = randomUUID();
  const accountId = randomUUID();
  const now = new Date().toISOString();
  database.exec("begin immediate;");
  try {
    database.prepare(`
      insert into lite_accounts(id, family_id, member_id, phone, display_name, password_hash, role, created_at)
      values (?, ?, ?, ?, ?, ?, 'member', ?)
    `).run(accountId, request.familyId, memberId, request.phone, request.displayName, request.passwordHash, now);
    database.prepare(`
      insert into lite_member_profiles(member_id, avatar_seed, relationship_label, relationship_role)
      values (?, ?, ?, ?)
    `).run(memberId, request.avatarSeed, request.relationshipLabel, request.relationshipRole);
    database.prepare("update lite_join_requests set status = 'approved', reviewed_by_member_id = ?, reviewed_at = ?, updated_at = ? where id = ?")
      .run(reviewerMemberId, now, now, requestId);
    database.prepare("update lite_invites set status = 'expired', used_count = 1, updated_at = ? where id = ?")
      .run(now, request.inviteId);
    database.exec("commit;");
  } catch (error) {
    database.exec("rollback;");
    throw error;
  }
  return memberId;
}

export function rejectLiteJoinRequest(requestId: string, reviewerMemberId: string) {
  const database = getLiteDatabase();
  const request = readLiteJoinRequest(requestId);
  if (!request) throw new Error("JOIN_REQUEST_NOT_FOUND");
  if (request.status !== "pending") throw new Error("JOIN_REQUEST_REVIEWED");
  const now = new Date().toISOString();
  database.exec("begin immediate;");
  try {
    database.prepare("update lite_join_requests set status = 'rejected', reviewed_by_member_id = ?, reviewed_at = ?, updated_at = ? where id = ?")
      .run(reviewerMemberId, now, now, requestId);
    database.prepare("update lite_invites set status = 'revoked', updated_at = ? where id = ?")
      .run(now, request.inviteId);
    database.exec("commit;");
  } catch (error) {
    database.exec("rollback;");
    throw error;
  }
}

function mapJoinRequest(row: JoinRequestRow): LiteJoinRequest {
  return {
    avatarSeed: row.avatar_seed,
    displayName: row.display_name,
    familyId: row.family_id,
    id: row.id,
    inviteId: row.invite_id,
    passwordHash: row.password_hash,
    phone: row.phone,
    relationshipLabel: row.relationship_label,
    relationshipRole: row.relationship_role === "parent" || row.relationship_role === "child" || row.relationship_role === "spouse" ? row.relationship_role : "relative",
    status: row.status === "approved" ? "approved" : row.status === "rejected" ? "rejected" : "pending"
  };
}
