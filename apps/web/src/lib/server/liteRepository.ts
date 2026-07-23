import { randomUUID } from "node:crypto";
import { familyMembers } from "../mockData";
import type { FamilyMember, FamilyRecord } from "../types";
import { getLiteDatabase } from "./liteDatabase";

export type LiteInstallation = {
  createdAt: string;
  familyId: string;
  familyName: string;
};

export type LiteAccount = {
  displayName: string;
  familyId: string;
  memberId: string;
  passwordHash: string;
  phone: string;
  role: "admin" | "member";
  sub: string;
};

type InstallationRow = {
  created_at: string;
  family_id: string;
  family_name: string;
};

type AccountRow = {
  display_name: string;
  family_id: string;
  id: string;
  member_id: string;
  password_hash: string;
  phone: string;
  role: string;
};

type RecordRow = {
  id: string;
  payload_json: string;
  updated_at: string;
};

type MemberProfileRow = {
  avatar_seed: string;
  member_id: string;
  profile_json: string;
  relationship_label: string;
  relationship_role: string;
};

export function readLiteInstallation(): LiteInstallation | null {
  const row = getLiteDatabase()
    .prepare("select family_id, family_name, created_at from lite_installation where id = 1")
    .get() as InstallationRow | undefined;
  return row ? { createdAt: row.created_at, familyId: row.family_id, familyName: row.family_name } : null;
}

export function readLiteAccounts(): LiteAccount[] {
  const rows = getLiteDatabase()
    .prepare("select id, family_id, member_id, phone, display_name, password_hash, role from lite_accounts order by created_at")
    .all() as AccountRow[];
  return rows.map((row) => ({
    displayName: row.display_name,
    familyId: row.family_id,
    memberId: row.member_id,
    passwordHash: row.password_hash,
    phone: row.phone,
    role: row.role === "admin" ? "admin" : "member",
    sub: row.id
  }));
}

export function readLiteFamilyMembers(): FamilyMember[] {
  const profiles = new Map((getLiteDatabase().prepare("select member_id, avatar_seed, relationship_label, relationship_role, profile_json from lite_member_profiles").all() as MemberProfileRow[])
    .map((profile) => [profile.member_id, profile]));
  const localMembers = readLiteAccounts().map((account, index) => {
    const profile = profiles.get(account.memberId);
    return ({
    id: account.memberId,
    displayName: account.displayName,
    role: account.role === "admin" ? "管理员" : "成员",
    profile: readMemberProfile(profile?.profile_json),
    relationshipRole: readRelationshipRole(profile?.relationship_role),
    relationshipLabel: profile?.relationship_label || undefined,
    status: "online" as const,
    avatarSeed: profile?.avatar_seed || `lite-${account.memberId}`,
    color: ["#2f6f68", "#9b6a42", "#5e6fb2", "#b15d6a"][index % 4]
    });
  });
  const assistant = familyMembers.find((member) => member.householdRoles?.includes("assistant"));
  return assistant ? [...localMembers, assistant] : localMembers;
}

export function updateLiteMemberProfile(input: {
  avatarSeed?: string;
  displayName?: string;
  familyId: string;
  memberId: string;
  profile?: FamilyMember["profile"];
}) {
  const database = getLiteDatabase();
  const account = database.prepare("select member_id from lite_accounts where member_id = ? and family_id = ?")
    .get(input.memberId, input.familyId);
  if (!account) return null;
  if (input.displayName) {
    database.prepare("update lite_accounts set display_name = ? where member_id = ? and family_id = ?")
      .run(input.displayName, input.memberId, input.familyId);
  }
  const current = database.prepare("select profile_json from lite_member_profiles where member_id = ?")
    .get(input.memberId) as { profile_json: string } | undefined;
  const mergedProfile = input.profile ? { ...readMemberProfile(current?.profile_json), ...input.profile } : readMemberProfile(current?.profile_json);
  database.prepare(`
    insert into lite_member_profiles(member_id, avatar_seed, relationship_label, relationship_role, profile_json)
    values (?, ?, '', 'relative', ?)
    on conflict(member_id) do update set
      avatar_seed = case when excluded.avatar_seed <> '' then excluded.avatar_seed else lite_member_profiles.avatar_seed end,
      profile_json = excluded.profile_json
  `).run(input.memberId, input.avatarSeed || "", JSON.stringify(mergedProfile || {}));
  return readLiteFamilyMembers().find((member) => member.id === input.memberId) || null;
}

export function updateLiteAccountPassword(input: { familyId: string; memberId: string; passwordHash: string }) {
  return Number(getLiteDatabase().prepare("update lite_accounts set password_hash = ? where member_id = ? and family_id = ?")
    .run(input.passwordHash, input.memberId, input.familyId).changes);
}

export function deleteLiteMember(familyId: string, memberId: string) {
  const database = getLiteDatabase();
  const account = database.prepare("select id from lite_accounts where family_id = ? and member_id = ? and role <> 'admin'")
    .get(familyId, memberId);
  if (!account) return 0;
  database.exec("begin immediate;");
  try {
    database.prepare("delete from lite_member_profiles where member_id = ?").run(memberId);
    const result = database.prepare("delete from lite_accounts where family_id = ? and member_id = ? and role <> 'admin'").run(familyId, memberId);
    database.exec("commit;");
    return Number(result.changes);
  } catch (error) {
    database.exec("rollback;");
    throw error;
  }
}

function readMemberProfile(value?: string): FamilyMember["profile"] {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as FamilyMember["profile"];
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readRelationshipRole(value?: string): FamilyMember["relationshipRole"] {
  return value === "parent" || value === "child" || value === "spouse" ? value : "relative";
}

export function createLiteInstallation(input: {
  displayName: string;
  familyName: string;
  passwordHash: string;
  phone: string;
}) {
  const database = getLiteDatabase();
  const existing = readLiteInstallation();
  if (existing) throw new Error("LITE_ALREADY_INITIALIZED");

  const createdAt = new Date().toISOString();
  const familyId = "local-family";
  const memberId = "me";
  database.exec("begin immediate;");
  try {
    database.prepare("insert into lite_installation(id, family_id, family_name, created_at) values (1, ?, ?, ?)")
      .run(familyId, input.familyName, createdAt);
    database.prepare(`
      insert into lite_accounts(id, family_id, member_id, phone, display_name, password_hash, role, created_at)
      values (?, ?, ?, ?, ?, ?, 'admin', ?)
    `).run(randomUUID(), familyId, memberId, input.phone, input.displayName, input.passwordHash, createdAt);
    database.exec("commit;");
  } catch (error) {
    database.exec("rollback;");
    throw error;
  }
  return { familyId, memberId };
}

export function listLiteFamilyRecords(familyId: string, limit = 200): FamilyRecord[] {
  const rows = getLiteDatabase()
    .prepare("select id, payload_json, updated_at from lite_family_records where family_id = ? order by updated_at desc limit ?")
    .all(familyId, limit) as RecordRow[];
  return rows.flatMap((row) => {
    try {
      const record = JSON.parse(row.payload_json) as FamilyRecord;
      return [{ ...record, id: row.id, occurredAt: record.occurredAt || row.updated_at }];
    } catch {
      return [];
    }
  });
}

export function saveLiteFamilyRecord(familyId: string, memberId: string, record: FamilyRecord) {
  const id = record.id || randomUUID();
  const updatedAt = new Date().toISOString();
  const stored = { ...record, id, updatedAt: record.updatedAt || "刚刚" };
  getLiteDatabase().prepare(`
    insert into lite_family_records(id, family_id, member_id, payload_json, updated_at)
    values (?, ?, ?, ?, ?)
    on conflict(id) do update set
      family_id = excluded.family_id,
      member_id = excluded.member_id,
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `).run(id, familyId, memberId, JSON.stringify(stored), updatedAt);
  return stored;
}

export function updateLiteFamilyRecord(input: {
  assignmentStatus?: FamilyRecord["assignmentStatus"];
  familyId: string;
  id: string;
  status: FamilyRecord["status"];
  taskResponses?: FamilyRecord["taskResponses"];
}) {
  const database = getLiteDatabase();
  const row = database.prepare("select payload_json from lite_family_records where id = ? and family_id = ?")
    .get(input.id, input.familyId) as { payload_json: string } | undefined;
  if (!row) return null;
  const record = JSON.parse(row.payload_json) as FamilyRecord;
  const updated: FamilyRecord = {
    ...record,
    ...(input.assignmentStatus ? { assignmentStatus: input.assignmentStatus } : {}),
    ...(input.taskResponses ? { taskResponses: input.taskResponses } : {}),
    status: input.status,
    updatedAt: "刚刚"
  };
  database.prepare("update lite_family_records set payload_json = ?, updated_at = ? where id = ? and family_id = ?")
    .run(JSON.stringify(updated), new Date().toISOString(), input.id, input.familyId);
  return updated;
}

export function deleteLiteFamilyRecord(familyId: string, id: string) {
  const result = getLiteDatabase().prepare("delete from lite_family_records where id = ? and family_id = ?").run(id, familyId);
  return Number(result.changes);
}
