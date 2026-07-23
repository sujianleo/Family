import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { FamilyRequestContextError, requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { FamilyRecordStoreError, createFamilyRecordStore } from "@/lib/server/familyRecordStore";
import { cancelRecordNotifications, createRecordNotifications } from "@/lib/server/notificationStore";
import type { AssignmentStatus, FamilyRecord, FamilyRecordAudience, FamilyRecordKind, FamilyRecordStatus } from "@/lib/types";

export const runtime = "nodejs";

const recordKinds = new Set<FamilyRecordKind>(["task", "note", "link", "media"]);
const recordStatuses = new Set<FamilyRecordStatus>(["todo", "doing", "done", "saved"]);
const audiences = new Set<FamilyRecordAudience>(["core", "guest"]);
const assignmentStatuses = new Set<AssignmentStatus>(["suggested", "assigned", "accepted", "done"]);

export async function GET(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const store = createFamilyRecordStore();
    return NextResponse.json({ backend: store.backend, records: await store.list(context.familyId) });
  } catch (error) {
    return errorResponse(error, "家庭记录读取失败。");
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const body = (await request.json()) as Partial<RecordPayload>;
    const title = readString(body.title);
    if (!title) return NextResponse.json({ detail: "缺少记录标题。" }, { status: 400 });

    const record = buildFamilyRecord(body, {
      assignmentStatus: assignmentStatuses.has(body.assignment_status as AssignmentStatus) ? body.assignment_status as AssignmentStatus : "assigned",
      audience: audiences.has(body.audience as FamilyRecordAudience) ? body.audience as FamilyRecordAudience : "core",
      createdByMemberId: context.memberId,
      kind: recordKinds.has(body.kind as FamilyRecordKind) ? body.kind as FamilyRecordKind : "note",
      status: recordStatuses.has(body.status as FamilyRecordStatus) ? body.status as FamilyRecordStatus : "saved",
      title
    });
    const store = createFamilyRecordStore();
    const contentHashes = new Set(
      (record.sourceFiles || [])
        .map((file) => readString(file.contentHash))
        .filter(Boolean)
    );
    if (contentHashes.size) {
      const existing = (await store.list(context.familyId)).find((candidate) =>
        (candidate.sourceFiles || []).some((file) =>
          contentHashes.has(readString(file.contentHash)) || matchesLegacyUploadedFile(file, record.sourceFiles || [])
        )
      );
      if (existing) {
        return NextResponse.json({
          backend: store.backend,
          deduplicated: true,
          id: existing.id,
          record: existing
        });
      }
    }
    const saved = await store.save({ familyId: context.familyId, memberId: context.memberId, record });
    await createRecordNotifications(context, toNotificationRecord(saved));
    return NextResponse.json({ backend: store.backend, deduplicated: false, id: saved.id, record: saved });
  } catch (error) {
    return errorResponse(error, "记录保存失败。");
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
    const id = readString(body.id);
    const status = recordStatuses.has(body.status as FamilyRecordStatus) ? body.status as FamilyRecordStatus : null;
    const assignmentStatus = assignmentStatuses.has(body.assignment_status as AssignmentStatus)
      ? body.assignment_status as AssignmentStatus
      : undefined;
    if (!id || !status) return NextResponse.json({ detail: "缺少有效记录 ID 或状态。" }, { status: 400 });

    const store = createFamilyRecordStore();
    const updated = await store.update({
      assignmentStatus,
      familyId: context.familyId,
      id,
      status,
      taskResponses: Array.isArray(body.task_responses) ? body.task_responses as FamilyRecord["taskResponses"] : undefined
    });
    if (!updated) return NextResponse.json({ detail: "记录不存在。" }, { status: 404 });
    if (status === "done") await cancelRecordNotifications(context, id);
    return NextResponse.json({ backend: store.backend, id, status });
  } catch (error) {
    return errorResponse(error, "记录更新失败。");
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const body = (await request.json().catch(() => ({}))) as { id?: unknown };
    const id = readString(body.id);
    if (!id) return NextResponse.json({ detail: "缺少记录 ID。" }, { status: 400 });

    const store = createFamilyRecordStore();
    const deletedCount = await store.delete(context.familyId, id);
    return NextResponse.json({ backend: store.backend, deleted: true, deletedCount, id });
  } catch (error) {
    return errorResponse(error, "记录删除失败。");
  }
}

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof FamilyRequestContextError || error instanceof FamilyRecordStoreError) {
    return NextResponse.json({ detail: error.message }, { status: error.status });
  }
  return NextResponse.json({ detail: error instanceof Error ? error.message : fallback }, { status: 500 });
}

type RecordPayload = {
  asset_type: FamilyRecord["assetType"];
  assignee_member_ids: string[];
  assignment_reason: string;
  assignment_status: AssignmentStatus;
  audience: FamilyRecordAudience;
  audio_path: string;
  chat_members: string[];
  chat_messages: FamilyRecord["chatMessages"];
  display_time: string;
  due_at: string;
  duration_ms: number;
  file_name: string;
  id: string;
  invite_link: string;
  kind: FamilyRecordKind;
  occurred_at: string;
  occurred_on: string;
  owner_name: string;
  owner_member_id: string;
  preview_url: string;
  recurrence: FamilyRecord["recurrence"];
  reminder_offsets: number[];
  source_avatar_seed: string;
  source_files: FamilyRecord["sourceFiles"];
  source_member_id: string;
  source_message_id: string;
  source_time_text: string;
  space_id: string;
  status: FamilyRecordStatus;
  summary: string;
  tags: string[];
  task_action_type: FamilyRecord["taskActionType"];
  task_options: string[];
  task_responses: FamilyRecord["taskResponses"];
  time_precision: FamilyRecord["timePrecision"];
  time_zone: string;
  title: string;
  transcript: string;
  updated_at: string;
};

type NormalizedRecordFields = {
  assignmentStatus: AssignmentStatus;
  audience: FamilyRecordAudience;
  createdByMemberId: string;
  kind: FamilyRecordKind;
  status: FamilyRecordStatus;
  title: string;
};

function buildFamilyRecord(body: Partial<RecordPayload>, fields: NormalizedRecordFields): FamilyRecord {
  return {
    id: readString(body.id) || randomUUID(),
    kind: fields.kind,
    title: fields.title.slice(0, 80),
    summary: readString(body.summary),
    ownerName: readString(body.owner_name) || "家人",
    ownerMemberId: readString(body.owner_member_id) || undefined,
    createdByMemberId: fields.createdByMemberId,
    spaceId: readString(body.space_id) || undefined,
    assigneeMemberIds: readStringArray(body.assignee_member_ids),
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
    taskOptions: readStringArray(body.task_options),
    taskResponses: Array.isArray(body.task_responses) ? body.task_responses : undefined,
    inviteLink: readString(body.invite_link) || undefined,
    chatMembers: readStringArray(body.chat_members),
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
    tags: readStringArray(body.tags)
  };
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function matchesLegacyUploadedFile(
  existing: NonNullable<FamilyRecord["sourceFiles"]>[number],
  incomingFiles: NonNullable<FamilyRecord["sourceFiles"]>
) {
  if (readString(existing.contentHash)) return false;
  return incomingFiles.some((incoming) =>
    Boolean(readString(incoming.contentHash)) &&
    existing.name === incoming.name &&
    typeof existing.size === "number" &&
    existing.size === incoming.size &&
    readString(existing.type) === readString(incoming.type)
  );
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()))]
    : [];
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
