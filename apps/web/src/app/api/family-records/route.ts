import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { familyMembers } from "@/lib/mockData";
import { FamilyRequestContextError, requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { cancelRecordNotifications, createRecordNotifications } from "@/lib/server/notificationStore";
import { readSupabaseServerUrl } from "@/lib/server/supabaseConfig";
import type { AssignmentStatus, Database, FamilyRecord, FamilyRecordAudience, FamilyRecordKind, FamilyRecordStatus, Json } from "@/lib/types";

export const runtime = "nodejs";

const supabaseUrl = readSupabaseServerUrl();
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const fallbackDbDir = "data";
const fallbackRecordsPath = "data/family-records.jsonl";

const recordKinds = new Set<FamilyRecordKind>(["task", "note", "link", "media"]);
const recordStatuses = new Set<FamilyRecordStatus>(["todo", "doing", "done", "saved"]);
const audiences = new Set<FamilyRecordAudience>(["core", "guest"]);
const assignmentStatuses = new Set<AssignmentStatus>(["suggested", "assigned", "accepted", "done"]);

export async function GET(request: Request) {
  let context;
  try {
    context = await requireFamilyRequestContext(request);
  } catch (error) {
    return requestContextErrorResponse(error);
  }
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    if (!canUseFileFallback()) {
      return NextResponse.json({ detail: "生产环境必须配置 Supabase 存储。" }, { status: 503 });
    }
    return NextResponse.json({ records: await readFallbackRecords() });
  }

  const supabase = createClient<Database>(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false }
  });
  const { data, error } = await supabase
    .from("family_records")
    .select(
      "id, member_id, space_id, created_by_member_id, kind, title, summary, status, tags, assignment_status, assignment_reason, assignee_member_ids, audience, updated_at, metadata"
    )
    .eq("family_id", context.familyId)
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ detail: error.message }, { status: 500 });
  }

  return NextResponse.json({
    records: (data || []).map((row) => {
      const metadata = readRecordMetadata(row.metadata);
      return {
        ...metadata,
        id: row.id,
        kind: recordKinds.has(row.kind as FamilyRecordKind) ? (row.kind as FamilyRecordKind) : "note",
        title: row.title || metadata.title || "未命名记录",
        summary: row.summary || metadata.summary || "",
        ownerName: metadata.ownerName || "家人",
        createdByMemberId: row.created_by_member_id || metadata.createdByMemberId,
        spaceId: row.space_id || metadata.spaceId,
        assigneeMemberIds: Array.isArray(row.assignee_member_ids) ? row.assignee_member_ids : metadata.assigneeMemberIds || [],
        audience: audiences.has(row.audience as FamilyRecordAudience) ? (row.audience as FamilyRecordAudience) : metadata.audience || "core",
        assignmentStatus: assignmentStatuses.has(row.assignment_status as AssignmentStatus)
          ? (row.assignment_status as AssignmentStatus)
          : metadata.assignmentStatus || "assigned",
        assignmentReason: row.assignment_reason || metadata.assignmentReason || "",
        status: recordStatuses.has(row.status as FamilyRecordStatus) ? (row.status as FamilyRecordStatus) : metadata.status || "saved",
        occurredAt: metadata.occurredAt || row.updated_at,
        updatedAt: metadata.updatedAt || formatRecordUpdatedAt(row.updated_at),
        tags: Array.isArray(row.tags) ? row.tags : metadata.tags || []
      } satisfies FamilyRecord;
    })
  });
}

export async function POST(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const body = (await request.json()) as Partial<RecordPayload>;
    const familyId = context.familyId;
    const memberId = context.memberId || null;
    let spaceId = normalizeUuid(readString(body.space_id) || process.env.SUPABASE_DEFAULT_CORE_SPACE_ID) || null;
    const createdByMemberId = memberId;
    const kind = recordKinds.has(body.kind as FamilyRecordKind) ? (body.kind as FamilyRecordKind) : "note";
    const status = recordStatuses.has(body.status as FamilyRecordStatus) ? (body.status as FamilyRecordStatus) : "saved";
    const audience = audiences.has(body.audience as FamilyRecordAudience) ? (body.audience as FamilyRecordAudience) : "core";
    const assignmentStatus = assignmentStatuses.has(body.assignment_status as AssignmentStatus)
      ? (body.assignment_status as AssignmentStatus)
      : "assigned";
    const title = readString(body.title);
    const requestedAssigneeMemberIds = Array.isArray(body.assignee_member_ids)
      ? [...new Set(body.assignee_member_ids.filter((id): id is string => typeof id === "string" && Boolean(id.trim())).map((id) => id.trim()))]
      : [];

    if (!title) {
      return NextResponse.json({ detail: "缺少记录标题。" }, { status: 400 });
    }

    if (!supabaseUrl || !supabaseServiceRoleKey || !familyId) {
      if (!canUseFileFallback()) {
        return NextResponse.json({ detail: "生产环境必须配置 Supabase 存储。" }, { status: 503 });
      }
      const allowedLocalMemberIds = new Set(
        familyMembers
          .filter((member) => member.relationshipRole !== "guest" && !member.householdRoles?.includes("assistant"))
          .map((member) => member.id)
      );
      if (requestedAssigneeMemberIds.some((id) => !allowedLocalMemberIds.has(id))) {
        return NextResponse.json({ detail: "任务负责人不属于当前家庭。" }, { status: 400 });
      }
      const fallbackRecord = buildFallbackRecord({ ...body, assignee_member_ids: requestedAssigneeMemberIds }, {
        assignmentStatus,
        audience,
        kind,
        status,
        title
      });
      await appendFallbackRecord(fallbackRecord);
      await createRecordNotifications(context, toNotificationRecord(fallbackRecord));
      return NextResponse.json({ id: fallbackRecord.id, storage: "file-fallback" });
    }

    const supabase = createClient<Database>(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false }
    });
    const recordId = normalizeUuid(body.id);
    const { data: existingRecord, error: existingRecordError } = recordId
      ? await supabase
          .from("family_records")
          .select("family_id,member_id,created_by_member_id")
          .eq("id", recordId)
          .maybeSingle()
      : { data: null, error: null };
    if (existingRecordError) {
      return NextResponse.json({ detail: existingRecordError.message }, { status: 500 });
    }
    if (existingRecord && existingRecord.family_id !== familyId) {
      return NextResponse.json({ detail: "记录不存在。" }, { status: 404 });
    }
    if (!spaceId) {
      const { data: coreSpace, error: coreSpaceError } = await supabase
        .from("family_spaces")
        .select("id")
        .eq("family_id", familyId)
        .eq("space_type", "core")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (coreSpaceError || !coreSpace?.id) {
        return NextResponse.json({ detail: "家庭核心空间尚未创建。" }, { status: 503 });
      }
      spaceId = coreSpace.id;
    }
    if (requestedAssigneeMemberIds.length) {
      const { data: assignees, error: assigneeError } = await supabase
        .from("family_members")
        .select("id, relationship_role, household_roles")
        .eq("family_id", familyId)
        .in("id", requestedAssigneeMemberIds);
      if (assigneeError) {
        return NextResponse.json({ detail: assigneeError.message }, { status: 500 });
      }
      const eligibleIds = new Set(
        (assignees || [])
          .filter((member) => member.relationship_role !== "guest" && !(Array.isArray(member.household_roles) && member.household_roles.includes("assistant")))
          .map((member) => member.id)
      );
      if (requestedAssigneeMemberIds.some((id) => !eligibleIds.has(id))) {
        return NextResponse.json({ detail: "任务负责人不属于当前家庭。" }, { status: 400 });
      }
    }
    const { data, error } = await supabase
      .from("family_records")
      .upsert({
        ...(recordId ? { id: recordId } : {}),
        family_id: familyId,
        member_id: existingRecord?.member_id || memberId,
        space_id: spaceId,
        created_by_member_id: existingRecord?.created_by_member_id || createdByMemberId,
        assignee_member_ids: requestedAssigneeMemberIds,
        audience,
        assignment_status: assignmentStatus,
        assignment_reason: readString(body.assignment_reason),
        kind,
        title: title.slice(0, 80),
        summary: readString(body.summary),
        status,
        tags: Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === "string") : [],
        metadata: toJson(buildRecordMetadata(body))
      }, { onConflict: "id" })
      .select("id")
      .single();

    if (error) {
      return NextResponse.json({ detail: error.message }, { status: 500 });
    }

    await createRecordNotifications(context, {
      id: readString(body.id) || data.id,
      title,
      kind,
      status,
      assigneeMemberIds: requestedAssigneeMemberIds,
      chatMembers: Array.isArray(body.chat_members) ? body.chat_members.filter((id): id is string => typeof id === "string") : [],
      chatMessages: Array.isArray(body.chat_messages) ? body.chat_messages : [],
      dueAt: readString(body.due_at) || undefined,
      reminderOffsets: readReminderOffsets(body.reminder_offsets)
    });
    return NextResponse.json({ id: data.id });
  } catch (error) {
    if (error instanceof FamilyRequestContextError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: error instanceof Error ? error.message : "记录保存失败。" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const body = (await request.json()) as {
      assignment_status?: unknown;
      id?: unknown;
      status?: unknown;
      task_responses?: unknown;
    };
    const id = normalizeUuid(body.id);
    const status = recordStatuses.has(body.status as FamilyRecordStatus) ? body.status as FamilyRecordStatus : null;
    const assignmentStatus = assignmentStatuses.has(body.assignment_status as AssignmentStatus)
      ? body.assignment_status as AssignmentStatus
      : null;
    if (!id || !status) {
      return NextResponse.json({ detail: "缺少有效记录 ID 或状态。" }, { status: 400 });
    }

    if (!supabaseUrl || !supabaseServiceRoleKey || !context.familyId) {
      if (!canUseFileFallback()) {
        return NextResponse.json({ detail: "生产环境必须配置 Supabase 存储。" }, { status: 503 });
      }
      const records = await readFallbackRecords();
      let found = false;
      const updated = records.map((record) => {
        if (record.id !== id) return record;
        found = true;
        return {
          ...record,
          assignmentStatus: assignmentStatus || record.assignmentStatus,
          status,
          taskResponses: Array.isArray(body.task_responses)
            ? body.task_responses as FamilyRecord["taskResponses"]
            : record.taskResponses,
          updatedAt: "刚刚"
        };
      });
      if (!found) return NextResponse.json({ detail: "记录不存在。" }, { status: 404 });
      await writeFallbackRecords(updated);
      if (status === "done") await cancelRecordNotifications(context, id);
      return NextResponse.json({ id, status });
    }

    const supabase = createClient<Database>(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false }
    });
    const { data: existing, error: readError } = await supabase
      .from("family_records")
      .select("metadata")
      .eq("id", id)
      .eq("family_id", context.familyId)
      .maybeSingle();
    if (readError) return NextResponse.json({ detail: readError.message }, { status: 500 });
    if (!existing) return NextResponse.json({ detail: "记录不存在。" }, { status: 404 });
    const metadata = {
      ...readRecordMetadata(existing.metadata),
      ...(Array.isArray(body.task_responses) ? { taskResponses: body.task_responses } : {}),
      updatedAt: "刚刚"
    };
    const { error } = await supabase
      .from("family_records")
      .update({
        ...(assignmentStatus ? { assignment_status: assignmentStatus } : {}),
        metadata: toJson(metadata),
        status,
        updated_at: new Date().toISOString()
      })
      .eq("id", id)
      .eq("family_id", context.familyId);
    if (error) return NextResponse.json({ detail: error.message }, { status: 500 });
    if (status === "done") await cancelRecordNotifications(context, id);
    return NextResponse.json({ id, status });
  } catch (error) {
    if (error instanceof FamilyRequestContextError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: error instanceof Error ? error.message : "记录更新失败。" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const body = (await request.json().catch(() => ({}))) as { id?: unknown };
    const requestedId = readString(body.id);
    if (!requestedId) {
      return NextResponse.json({ detail: "缺少记录 ID。" }, { status: 400 });
    }

    if (!supabaseUrl || !supabaseServiceRoleKey || !context.familyId) {
      if (!canUseFileFallback()) {
        return NextResponse.json({ detail: "生产环境必须配置 Supabase 存储。" }, { status: 503 });
      }
      const records = await readFallbackRecords();
      const remainingRecords = records.filter((record) => record.id !== requestedId);
      if (remainingRecords.length !== records.length) {
        await writeFallbackRecords(remainingRecords);
      }
      return NextResponse.json({ deleted: true, deletedCount: records.length - remainingRecords.length, id: requestedId });
    }

    const supabase = createClient<Database>(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false }
    });
    const uuid = normalizeUuid(requestedId);
    let targetIds = uuid ? [uuid] : [];
    if (!uuid) {
      const { data: legacyRecords, error: legacyReadError } = await supabase
        .from("family_records")
        .select("id")
        .eq("family_id", context.familyId)
        .eq("metadata->>recordId", requestedId);
      if (legacyReadError) {
        return NextResponse.json({ detail: legacyReadError.message }, { status: 500 });
      }
      targetIds = (legacyRecords || []).map((record) => record.id);
    }
    if (!targetIds.length) {
      // Deletion is idempotent. Old local-only resources have no Supabase row,
      // but the client must still be allowed to remove them permanently.
      return NextResponse.json({ deleted: true, deletedCount: 0, id: requestedId });
    }
    const { data, error } = await supabase
      .from("family_records")
      .delete()
      .eq("family_id", context.familyId)
      .in("id", targetIds)
      .select("id");
    if (error) {
      return NextResponse.json({ detail: error.message }, { status: 500 });
    }
    return NextResponse.json({ deleted: true, deletedCount: data?.length || 0, id: requestedId });
  } catch (error) {
    if (error instanceof FamilyRequestContextError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: error instanceof Error ? error.message : "记录删除失败。" }, { status: 500 });
  }
}

function requestContextErrorResponse(error: unknown) {
  if (error instanceof FamilyRequestContextError) {
    return NextResponse.json({ detail: error.message }, { status: error.status });
  }
  return NextResponse.json({ detail: "家庭访问验证失败。" }, { status: 500 });
}

function isProductionRuntime() {
  return process.env.NODE_ENV === "production";
}

function canUseFileFallback() {
  return !isProductionRuntime() || process.env.FAMILY_APP_ALLOW_FILE_FALLBACK === "true";
}

type RecordPayload = {
  id: string;
  family_id: string;
  member_id: string;
  space_id: string;
  created_by_member_id: string;
  assignee_member_ids: string[];
  audience: FamilyRecordAudience;
  assignment_status: AssignmentStatus;
  assignment_reason: string;
  kind: FamilyRecordKind;
  title: string;
  summary: string;
  owner_name: string;
  updated_at: string;
  asset_type: FamilyRecord["assetType"];
  audio_path: string;
  duration_ms: number;
  file_name: string;
  preview_url: string;
  source_files: FamilyRecord["sourceFiles"];
  display_time: string;
  due_at: string;
  occurred_at: string;
  occurred_on: string;
  time_zone: string;
  time_precision: FamilyRecord["timePrecision"];
  source_time_text: string;
  reminder_offsets: number[];
  recurrence: FamilyRecord["recurrence"];
  task_action_type: FamilyRecord["taskActionType"];
  task_options: string[];
  task_responses: FamilyRecord["taskResponses"];
  invite_link: string;
  chat_members: string[];
  chat_messages: FamilyRecord["chatMessages"];
  source_avatar_seed: string;
  source_member_id: string;
  source_message_id: string;
  transcript: string;
  status: FamilyRecordStatus;
  tags: string[];
};

type NormalizedRecordFields = {
  assignmentStatus: AssignmentStatus;
  audience: FamilyRecordAudience;
  kind: FamilyRecordKind;
  status: FamilyRecordStatus;
  title: string;
};

type FallbackRecordRow = {
  record: FamilyRecord;
  savedAt: string;
};

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeUuid(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : "";
}

function buildFallbackRecord(body: Partial<RecordPayload>, fields: NormalizedRecordFields): FamilyRecord {
  return {
    id: readString(body.id) || `record-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: fields.kind,
    title: fields.title.slice(0, 80),
    summary: readString(body.summary),
    ownerName: readString(body.owner_name) || "家人",
    createdByMemberId: readString(body.created_by_member_id) || undefined,
    assigneeMemberIds: Array.isArray(body.assignee_member_ids) ? body.assignee_member_ids.filter((id): id is string => typeof id === "string") : [],
    audience: fields.audience,
    assignmentStatus: fields.assignmentStatus,
    assignmentReason: readString(body.assignment_reason) || undefined,
    displayTime: readString(body.display_time) || undefined,
    dueAt: readString(body.due_at) || undefined,
    occurredAt: readString(body.occurred_at) || undefined,
    occurredOn: readString(body.occurred_on) || undefined,
    timeZone: readString(body.time_zone) || undefined,
    timePrecision: readTimePrecision(body.time_precision),
    sourceTimeText: readString(body.source_time_text) || undefined,
    reminderOffsets: readReminderOffsets(body.reminder_offsets),
    recurrence: readTaskRecurrence(body.recurrence),
    taskActionType: body.task_action_type,
    taskOptions: Array.isArray(body.task_options) ? body.task_options.filter((item): item is string => typeof item === "string") : undefined,
    taskResponses: Array.isArray(body.task_responses) ? body.task_responses : undefined,
    inviteLink: readString(body.invite_link) || undefined,
    chatMembers: Array.isArray(body.chat_members) ? body.chat_members.filter((item): item is string => typeof item === "string") : undefined,
    chatMessages: Array.isArray(body.chat_messages) ? body.chat_messages : undefined,
    assetType: body.asset_type,
    audioPath: readString(body.audio_path) || undefined,
    durationMs: readDurationMs(body.duration_ms),
    fileName: readString(body.file_name) || undefined,
    previewUrl: readString(body.preview_url) || undefined,
    sourceAvatarSeed: readString(body.source_avatar_seed) || undefined,
    sourceFiles: Array.isArray(body.source_files) ? body.source_files : undefined,
    sourceMemberId: readString(body.source_member_id) || undefined,
    sourceMessageId: readString(body.source_message_id) || undefined,
    transcript: readString(body.transcript) || undefined,
    status: fields.status,
    updatedAt: readString(body.updated_at) || "刚刚",
    tags: Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === "string") : []
  };
}

function buildRecordMetadata(body: Partial<RecordPayload>) {
  return {
    recordId: readString(body.id) || undefined,
    ownerName: readString(body.owner_name) || undefined,
    updatedAt: readString(body.updated_at) || undefined,
    displayTime: readString(body.display_time) || undefined,
    dueAt: readString(body.due_at) || undefined,
    occurredAt: readString(body.occurred_at) || undefined,
    occurredOn: readString(body.occurred_on) || undefined,
    timeZone: readString(body.time_zone) || undefined,
    timePrecision: readTimePrecision(body.time_precision),
    sourceTimeText: readString(body.source_time_text) || undefined,
    reminderOffsets: readReminderOffsets(body.reminder_offsets),
    recurrence: readTaskRecurrence(body.recurrence),
    taskActionType: body.task_action_type,
    taskOptions: Array.isArray(body.task_options) ? body.task_options.filter((item): item is string => typeof item === "string") : undefined,
    taskResponses: Array.isArray(body.task_responses) ? body.task_responses : undefined,
    inviteLink: readString(body.invite_link) || undefined,
    chatMembers: Array.isArray(body.chat_members) ? body.chat_members.filter((item): item is string => typeof item === "string") : undefined,
    chatMessages: Array.isArray(body.chat_messages) ? body.chat_messages : undefined,
    assetType: body.asset_type,
    audioPath: readString(body.audio_path) || undefined,
    durationMs: readDurationMs(body.duration_ms),
    fileName: readString(body.file_name) || undefined,
    previewUrl: readString(body.preview_url) || undefined,
    sourceAvatarSeed: readString(body.source_avatar_seed) || undefined,
    sourceFiles: Array.isArray(body.source_files) ? body.source_files : undefined,
    sourceMemberId: readString(body.source_member_id) || undefined,
    sourceMessageId: readString(body.source_message_id) || undefined,
    transcript: readString(body.transcript) || undefined
  } satisfies Partial<FamilyRecord> & { recordId?: string };
}

function readRecordMetadata(value: unknown): Partial<FamilyRecord> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const metadata = value as Partial<FamilyRecord> & {
    asset_type?: unknown;
    audio_path?: unknown;
    duration_ms?: unknown;
    transcript?: unknown;
  };
  const legacyAssetType = metadata.asset_type === "voice" ? "audio" : metadata.asset_type;
  return {
    ...metadata,
    assetType: metadata.assetType || (typeof legacyAssetType === "string" ? legacyAssetType as FamilyRecord["assetType"] : undefined),
    audioPath: metadata.audioPath || readString(metadata.audio_path) || undefined,
    durationMs: metadata.durationMs || readDurationMs(metadata.duration_ms),
    transcript: metadata.transcript ? readString(metadata.transcript) : undefined
  };
}

function formatRecordUpdatedAt(value: string | null) {
  if (!value) {
    return "刚刚";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "已保存";
  }

  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? {})) as Json;
}

async function appendFallbackRecord(record: FamilyRecord) {
  await mkdir(fallbackDbDir, { recursive: true });
  const row: FallbackRecordRow = {
    record,
    savedAt: new Date().toISOString()
  };
  await appendFile(fallbackRecordsPath, `${JSON.stringify(row)}\n`, "utf8");
}

async function writeFallbackRecords(records: FamilyRecord[]) {
  await mkdir(fallbackDbDir, { recursive: true });
  const savedAt = new Date().toISOString();
  const content = records
    .map((record) => JSON.stringify({ record, savedAt } satisfies FallbackRecordRow))
    .join("\n");
  await writeFile(fallbackRecordsPath, content ? `${content}\n` : "", "utf8");
}

async function readFallbackRecords() {
  let content = "";
  try {
    content = await readFile(fallbackRecordsPath, "utf8");
  } catch {
    return [];
  }

  const byId = new Map<string, FallbackRecordRow>();
  for (const line of content.split(/\n+/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const row = JSON.parse(line) as FallbackRecordRow;
      if (row.record?.id) {
        byId.set(row.record.id, row);
      }
    } catch {
      // Ignore a malformed dev row and keep the public app readable.
    }
  }

  return [...byId.values()]
    .sort((left, right) => right.savedAt.localeCompare(left.savedAt))
    .slice(0, 200)
    .map((row) => ({ ...row.record, occurredAt: row.record.occurredAt || row.savedAt }));
}

function readReminderOffsets(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is number => Number.isInteger(item) && item >= 0 && item <= 10080).slice(0, 4) : [15, 0];
}

function readTaskRecurrence(value: unknown): FamilyRecord["recurrence"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const recurrence = value as Record<string, unknown>;
  const allowedKinds = new Set(["daily", "interval_days", "interval_weeks", "monthly", "weekdays", "weekly"]);
  const kind = typeof recurrence.kind === "string" && allowedKinds.has(recurrence.kind)
    ? recurrence.kind as NonNullable<FamilyRecord["recurrence"]>["kind"]
    : undefined;
  const interval = typeof recurrence.interval === "number" && Number.isInteger(recurrence.interval)
    ? Math.max(1, Math.min(365, recurrence.interval))
    : 1;
  const label = readString(recurrence.label).slice(0, 60);
  if (!kind || !label) return undefined;
  const weekdays = Array.isArray(recurrence.weekdays)
    ? recurrence.weekdays.filter((day): day is number => Number.isInteger(day) && day >= 1 && day <= 7)
    : undefined;
  const dayOfMonth = typeof recurrence.dayOfMonth === "number" && Number.isInteger(recurrence.dayOfMonth)
    ? Math.max(1, Math.min(31, recurrence.dayOfMonth))
    : undefined;
  return { dayOfMonth, interval, kind, label, weekdays };
}

function readDurationMs(value: unknown) {
  const duration = typeof value === "number" ? value : Number(value);
  return Number.isFinite(duration) && duration > 0 ? Math.round(duration) : undefined;
}

function readTimePrecision(value: unknown): FamilyRecord["timePrecision"] {
  return value === "date" || value === "minute" || value === "duration" || value === "recurrence" ? value : undefined;
}

function toNotificationRecord(record: FamilyRecord) {
  return {
    id: record.id,
    title: record.title,
    kind: record.kind,
    status: record.status,
    assigneeMemberIds: record.assigneeMemberIds || [],
    chatMembers: record.chatMembers || [],
    chatMessages: (record.chatMessages || []).map((message) => ({ id: message.id, body: message.body, senderMemberId: message.senderMemberId, senderName: message.senderName })),
    dueAt: record.dueAt,
    reminderOffsets: record.reminderOffsets
  };
}
