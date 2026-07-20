import type { AssignmentSuggestion, FamilyRecord } from "./types";
import { familyFetch } from "./familyApi";

const familyId = process.env.NEXT_PUBLIC_SUPABASE_FAMILY_ID || "";
const memberId = process.env.NEXT_PUBLIC_SUPABASE_MEMBER_ID || "";
const coreSpaceId = process.env.NEXT_PUBLIC_SUPABASE_CORE_SPACE_ID || "core";

export async function enqueueFamilyRecord(record: FamilyRecord) {
  const res = await familyFetch("/api/family-records", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: record.id,
      family_id: familyId,
      member_id: memberId,
      space_id: normalizeSupabaseId(record.spaceId || coreSpaceId),
      created_by_member_id: record.createdByMemberId || memberId,
      assignee_member_ids: record.assigneeMemberIds || [],
      audience: record.audience || "core",
      assignment_status: record.assignmentStatus || "assigned",
      assignment_reason: record.assignmentReason || "",
      kind: record.kind,
      title: record.title,
      summary: record.summary,
      owner_name: record.ownerName,
      updated_at: record.updatedAt,
      display_time: record.displayTime,
      due_at: record.dueAt,
      occurred_at: record.occurredAt,
      occurred_on: record.occurredOn,
      time_zone: record.timeZone,
      time_precision: record.timePrecision,
      source_time_text: record.sourceTimeText,
      reminder_offsets: record.reminderOffsets || [15, 0],
      recurrence: record.recurrence,
      task_action_type: record.taskActionType,
      task_options: record.taskOptions || [],
      task_responses: record.taskResponses || [],
      invite_link: record.inviteLink,
      chat_members: record.chatMembers || [],
      chat_messages: record.chatMessages || [],
      asset_type: record.assetType,
      audio_path: record.audioPath,
      duration_ms: record.durationMs,
      file_name: record.fileName,
      preview_url: record.previewUrl,
      source_avatar_seed: record.sourceAvatarSeed,
      source_files: record.sourceFiles || [],
      source_member_id: record.sourceMemberId,
      source_message_id: record.sourceMessageId,
      transcript: record.transcript,
      status: record.status,
      tags: record.tags
    })
  });

  if (!res.ok) {
    return null;
  }

  return (await res.json()) as { id: string };
}

export async function updateFamilyRecord(record: Pick<FamilyRecord, "id" | "status" | "assignmentStatus" | "taskResponses">) {
  const res = await familyFetch("/api/family-records", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      assignment_status: record.assignmentStatus,
      id: record.id,
      status: record.status,
      task_responses: record.taskResponses || []
    })
  });
  return res.ok;
}

function normalizeSupabaseId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : "";
}

export async function requestAssignmentSuggestion(text: string, mentionedMemberIds: string[] = [], contextTab = "群聊", timeoutMs = 1200) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;

  try {
    res = await familyFetch("/api/assignment-suggestions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        space_id: coreSpaceId,
        text,
        sender_member_id: memberId || "me",
        mentioned_member_ids: mentionedMemberIds,
        context_tab: contextTab,
        time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai"
      })
    });
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (!res.ok) {
    return null;
  }

  const data = (await res.json()) as {
    suggested_assignees: AssignmentSuggestion["suggestedAssignees"];
    suggested_roles: string[];
    reason: string;
    confidence: number;
    display_time?: string;
    due_at?: string;
    source_text?: string;
    requires_clarification?: boolean;
    clarification_message?: string;
    personal_todo?: boolean;
    source?: AssignmentSuggestion["source"];
    task_title?: string;
    task_action_type?: AssignmentSuggestion["taskActionType"];
    task_options?: string[];
  };

  return {
    suggestedAssignees: data.suggested_assignees,
    suggestedRoles: data.suggested_roles,
    reason: data.reason,
    confidence: data.confidence,
    displayTime: data.display_time,
    dueAt: data.due_at,
    sourceText: data.source_text || text,
    requiresClarification: data.requires_clarification,
    clarificationMessage: data.clarification_message,
    personalTodo: data.personal_todo,
    source: data.source,
    taskTitle: data.task_title,
    taskActionType: data.task_action_type,
    taskOptions: data.task_options
  } satisfies AssignmentSuggestion;
}

export async function requestResourceInsight(record: FamilyRecord) {
  if (!record.sourceFiles?.length) {
    return null;
  }

  try {
    const res = await familyFetch("/api/resource-insights", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actor_member_id: record.createdByMemberId || memberId || "me",
        actor_name: record.ownerName,
        record_id: record.id,
        resource_title: record.title,
        source_files: record.sourceFiles,
        space_id: record.spaceId || coreSpaceId
      })
    });

    if (!res.ok) {
      return null;
    }

    return (await res.json()) as {
      analysisText: string;
      insightKind: "document" | "resume" | "health_checkup";
      memberIds: string[];
      question?: string;
      status: "needs_clarification" | "parsed";
      textLength: number;
    };
  } catch {
    return null;
  }
}
