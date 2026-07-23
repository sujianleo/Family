import type { AssignmentStatus, FamilyRecord, FamilyRecordStatus, Json } from "../types";
import { readFamilyBackend } from "./familyBackend";
import {
  deleteLiteFamilyRecord,
  listLiteFamilyRecords,
  readLiteAccounts,
  saveLiteFamilyRecord,
  updateLiteFamilyRecord
} from "./liteRepository";
import { createServiceSupabaseClient } from "./supabaseServer";

export type SaveFamilyRecordInput = {
  familyId: string;
  memberId: string;
  record: FamilyRecord;
};

export type UpdateFamilyRecordInput = {
  assignmentStatus?: AssignmentStatus;
  familyId: string;
  id: string;
  status: FamilyRecordStatus;
  taskResponses?: FamilyRecord["taskResponses"];
};

export interface FamilyRecordStore {
  readonly backend: "sqlite" | "supabase";
  delete(familyId: string, id: string): Promise<number>;
  list(familyId: string): Promise<FamilyRecord[]>;
  save(input: SaveFamilyRecordInput): Promise<FamilyRecord>;
  update(input: UpdateFamilyRecordInput): Promise<FamilyRecord | null>;
}

export class FamilyRecordStoreError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 500 | 503
  ) {
    super(message);
  }
}

export function createFamilyRecordStore(): FamilyRecordStore {
  return readFamilyBackend() === "sqlite" ? sqliteFamilyRecordStore : supabaseFamilyRecordStore;
}

const sqliteFamilyRecordStore: FamilyRecordStore = {
  backend: "sqlite",
  async list(familyId) {
    return listLiteFamilyRecords(familyId);
  },
  async save({ familyId, memberId, record }) {
    const allowedIds = new Set([
      ...readLiteAccounts().map((account) => account.memberId)
    ]);
    if ((record.assigneeMemberIds || []).some((id) => !allowedIds.has(id))) {
      throw new FamilyRecordStoreError("任务负责人不属于当前本地家庭。", 400);
    }
    return saveLiteFamilyRecord(familyId, memberId, record);
  },
  async update(input) {
    return updateLiteFamilyRecord(input);
  },
  async delete(familyId, id) {
    return deleteLiteFamilyRecord(familyId, id);
  }
};

const supabaseFamilyRecordStore: FamilyRecordStore = {
  backend: "supabase",
  async list(familyId) {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("family_records")
      .select("id, member_id, space_id, created_by_member_id, kind, title, summary, status, tags, assignment_status, assignment_reason, assignee_member_ids, audience, updated_at, metadata")
      .eq("family_id", familyId)
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) throw new FamilyRecordStoreError(error.message, 500);
    return (data || []).map((row) => {
      const metadata = readRecordMetadata(row.metadata);
      return {
        ...metadata,
        id: row.id,
        kind: row.kind,
        title: row.title || metadata.title || "未命名记录",
        summary: row.summary || metadata.summary || "",
        ownerName: metadata.ownerName || "家人",
        createdByMemberId: row.created_by_member_id || metadata.createdByMemberId,
        spaceId: row.space_id || metadata.spaceId,
        assigneeMemberIds: Array.isArray(row.assignee_member_ids) ? row.assignee_member_ids : metadata.assigneeMemberIds || [],
        audience: row.audience,
        assignmentStatus: row.assignment_status,
        assignmentReason: row.assignment_reason || metadata.assignmentReason || "",
        status: row.status,
        occurredAt: metadata.occurredAt || row.updated_at,
        updatedAt: metadata.updatedAt || formatRecordUpdatedAt(row.updated_at),
        tags: Array.isArray(row.tags) ? row.tags : metadata.tags || []
      } satisfies FamilyRecord;
    });
  },
  async save({ familyId, memberId, record }) {
    const supabase = requireSupabase();
    const recordId = normalizeUuid(record.id);
    const { data: existing, error: existingError } = recordId
      ? await supabase.from("family_records").select("family_id, member_id, created_by_member_id").eq("id", recordId).maybeSingle()
      : { data: null, error: null };
    if (existingError) throw new FamilyRecordStoreError(existingError.message, 500);
    if (existing && existing.family_id !== familyId) throw new FamilyRecordStoreError("记录不存在。", 404);

    let spaceId = normalizeUuid(record.spaceId || process.env.SUPABASE_DEFAULT_CORE_SPACE_ID);
    if (!spaceId) {
      const { data: coreSpace, error: coreSpaceError } = await supabase
        .from("family_spaces")
        .select("id")
        .eq("family_id", familyId)
        .eq("space_type", "core")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (coreSpaceError || !coreSpace?.id) throw new FamilyRecordStoreError("家庭核心空间尚未创建。", 503);
      spaceId = coreSpace.id;
    }

    const assigneeIds = record.assigneeMemberIds || [];
    if (assigneeIds.length) {
      const { data: assignees, error: assigneeError } = await supabase
        .from("family_members")
        .select("id, relationship_role, household_roles")
        .eq("family_id", familyId)
        .in("id", assigneeIds);
      if (assigneeError) throw new FamilyRecordStoreError(assigneeError.message, 500);
      const eligibleIds = new Set(
        (assignees || [])
          .filter((candidate) => candidate.relationship_role !== "guest" && !(Array.isArray(candidate.household_roles) && candidate.household_roles.includes("assistant")))
          .map((candidate) => candidate.id)
      );
      if (assigneeIds.some((id) => !eligibleIds.has(id))) throw new FamilyRecordStoreError("任务负责人不属于当前家庭。", 400);
    }

    const { data, error } = await supabase.from("family_records").upsert({
      ...(recordId ? { id: recordId } : {}),
      family_id: familyId,
      member_id: existing?.member_id || memberId,
      space_id: spaceId,
      created_by_member_id: existing?.created_by_member_id || memberId,
      assignee_member_ids: assigneeIds,
      audience: record.audience || "core",
      assignment_status: record.assignmentStatus || "assigned",
      assignment_reason: record.assignmentReason || "",
      kind: record.kind,
      title: record.title.slice(0, 80),
      summary: record.summary || "",
      status: record.status,
      tags: record.tags || [],
      metadata: toJson({ ...record, recordId: record.id })
    }, { onConflict: "id" }).select("id").single();
    if (error) throw new FamilyRecordStoreError(error.message, 500);
    return { ...record, id: data.id, spaceId };
  },
  async update(input) {
    const supabase = requireSupabase();
    const id = normalizeUuid(input.id);
    if (!id) return null;
    const { data: existing, error: readError } = await supabase
      .from("family_records")
      .select("id, kind, title, summary, status, tags, assignment_status, assignment_reason, assignee_member_ids, audience, updated_at, metadata")
      .eq("id", id)
      .eq("family_id", input.familyId)
      .maybeSingle();
    if (readError) throw new FamilyRecordStoreError(readError.message, 500);
    if (!existing) return null;
    const metadata = {
      ...readRecordMetadata(existing.metadata),
      ...(input.taskResponses ? { taskResponses: input.taskResponses } : {}),
      updatedAt: "刚刚"
    };
    const { error } = await supabase.from("family_records").update({
      ...(input.assignmentStatus ? { assignment_status: input.assignmentStatus } : {}),
      metadata: toJson(metadata),
      status: input.status,
      updated_at: new Date().toISOString()
    }).eq("id", id).eq("family_id", input.familyId);
    if (error) throw new FamilyRecordStoreError(error.message, 500);
    return {
      ...metadata,
      id,
      kind: existing.kind,
      title: existing.title,
      summary: existing.summary || "",
      status: input.status,
      tags: existing.tags || [],
      assignmentStatus: input.assignmentStatus || existing.assignment_status,
      assignmentReason: existing.assignment_reason || "",
      assigneeMemberIds: existing.assignee_member_ids || [],
      audience: existing.audience,
      updatedAt: "刚刚"
    } as FamilyRecord;
  },
  async delete(familyId, requestedId) {
    const supabase = requireSupabase();
    const uuid = normalizeUuid(requestedId);
    let targetIds = uuid ? [uuid] : [];
    if (!targetIds.length) {
      const { data, error } = await supabase
        .from("family_records")
        .select("id")
        .eq("family_id", familyId)
        .eq("metadata->>recordId", requestedId);
      if (error) throw new FamilyRecordStoreError(error.message, 500);
      targetIds = (data || []).map((record) => record.id);
    }
    if (!targetIds.length) return 0;
    const { data, error } = await supabase.from("family_records").delete().eq("family_id", familyId).in("id", targetIds).select("id");
    if (error) throw new FamilyRecordStoreError(error.message, 500);
    return data?.length || 0;
  }
};

function requireSupabase() {
  const client = createServiceSupabaseClient();
  if (!client) throw new FamilyRecordStoreError("Supabase 存储尚未配置。", 503);
  return client;
}

function normalizeUuid(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : "";
}

function readRecordMetadata(value: unknown): Partial<FamilyRecord> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Partial<FamilyRecord> : {};
}

function formatRecordUpdatedAt(value: string | null) {
  if (!value) return "刚刚";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "已保存";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", hour12: false, minute: "2-digit" });
}

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? {})) as Json;
}
