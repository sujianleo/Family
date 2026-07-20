import { NextResponse } from "next/server";
import { resolveFamilyMemberMention, suggestAssignment } from "@/lib/assignment";
import { familyMembers } from "@/lib/mockData";
import { invokeTaskExtractChain } from "@/lib/server/ai/chains/task-extract.chain";
import type { TaskExtractOutput } from "@/lib/server/ai/schemas/task.schema";
import { classifyTaskIntent, inferTaskActionType, inferTaskOptions, normalizeTaskTitle, parseTaskReminder, type TaskIntent } from "@/lib/taskIntent";
import type { AssignmentSuggestion, FamilyMember } from "@/lib/types";
import { FamilyRequestContextError, requireFamilyRequestContext } from "@/lib/server/familyRequestContext";

export const runtime = "nodejs";

const deepseekTimeoutMs = Number(process.env.DEEPSEEK_TIMEOUT_MS || 4000);
const suggestionCache = new Map<string, AssignmentSuggestionWithSource>();

export async function POST(request: Request) {
  try {
    await requireFamilyRequestContext(request);
    const body = (await request.json()) as Partial<AssignmentSuggestionPayload>;
    const text = readString(body.text);

    if (!text) {
      return NextResponse.json({ detail: "缺少需要派发的内容。" }, { status: 400 });
    }

    const mentionedMemberIds = Array.isArray(body.mentioned_member_ids)
      ? body.mentioned_member_ids.filter((id): id is string => typeof id === "string")
      : [];
    const contextTab = readString(body.context_tab) || "群聊";
    const senderMemberId = readString(body.sender_member_id) || "me";
    const timeZone = validTimeZone(readString(body.time_zone)) || "Asia/Shanghai";
    const receivedAt = new Date();
    const reminder = parseTaskReminder(text, receivedAt, timeZone);
    const taskIntent = classifyTaskIntent(text, {
      contextTab,
      mentionedMemberIds,
      senderMemberId
    }, receivedAt, timeZone);
    const localSuggestion = suggestLocalSuggestion(text, senderMemberId, mentionedMemberIds, contextTab, taskIntent);
    const deterministicSuggestion =
      suggestOpenVolunteerQuestion(text, senderMemberId, taskIntent) ||
      (taskIntent.taskKind === "family_help" ||
      taskIntent.taskKind === "health_followup" ||
      taskIntent.taskKind === "personal_todo" ||
      taskIntent.taskKind === "task_breakdown" ||
      Boolean(taskIntent.dueAt)
        ? localSuggestion
        : null);
    const suggestion = deterministicSuggestion || (await requestDeepSeekSuggestion(text, senderMemberId, mentionedMemberIds, contextTab)) || localSuggestion;

    return NextResponse.json({
      suggested_assignees: suggestion.suggestedAssignees,
      suggested_roles: suggestion.suggestedRoles,
      reason: suggestion.reason,
      confidence: suggestion.confidence,
      display_time: suggestion.displayTime || taskIntent.displayTime || "",
      due_at: taskIntent.dueAt || "",
      source_text: text,
      requires_clarification: reminder.requiresClarification,
      clarification_message: reminder.clarificationMessage || "",
      personal_todo: suggestion.personalTodo ?? taskIntent.taskKind === "personal_todo",
      task_intent: taskIntent.taskKind,
      task_title: reminder.requiresClarification ? "" : normalizeTaskTitle(reminder.isReminder ? reminder.title : suggestion.taskTitle || taskIntent.title, suggestion.displayTime || taskIntent.displayTime),
      task_action_type: suggestion.taskActionType || taskIntent.taskActionType,
      task_options: suggestion.taskOptions || taskIntent.options,
      source: suggestion.source
    });
  } catch (error) {
    if (error instanceof FamilyRequestContextError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: error instanceof Error ? error.message : "派发建议生成失败。" }, { status: 500 });
  }
}

type AssignmentSuggestionPayload = {
  space_id: string;
  text: string;
  sender_member_id: string;
  mentioned_member_ids: string[];
  context_tab: string;
  time_zone?: string;
};

type AssignmentSuggestionWithSource = AssignmentSuggestion & {
  source: "deepseek" | "local";
};

async function requestDeepSeekSuggestion(
  text: string,
  senderMemberId: string,
  mentionedMemberIds: string[],
  contextTab: string
): Promise<AssignmentSuggestionWithSource | null> {
  const cacheKey = JSON.stringify({ text, senderMemberId, mentionedMemberIds, contextTab });
  const cached = suggestionCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const members = familyMembers.map((member) => ({
    id: member.id,
    displayName: member.displayName,
    relationshipRole: member.relationshipRole,
    profile: member.profile || {}
  }));

  try {
    const json = await invokeTaskExtractChain(
      {
        contextTab,
        members,
        mentionedMemberIds,
        senderMemberId: senderMemberId || "me",
        text
      },
      { timeoutMs: deepseekTimeoutMs }
    );

    if (!json) {
      return null;
    }

    const suggestion = normalizeDeepSeekSuggestion(json, text, senderMemberId);

    if (suggestion) {
      suggestionCache.set(cacheKey, suggestion);
      if (suggestionCache.size > 80) {
        const firstKey = suggestionCache.keys().next().value;
        if (firstKey) suggestionCache.delete(firstKey);
      }
    }

    return suggestion;
  } catch {
    return null;
  }
}

function normalizeDeepSeekSuggestion(json: TaskExtractOutput, text: string, senderMemberId: string): AssignmentSuggestionWithSource | null {
  const assigneeIds = Array.isArray(json.suggested_assignee_ids) ? json.suggested_assignee_ids : [];
  const normalizedAssigneeIds = assigneeIds.length > 0 ? assigneeIds : [senderMemberId || "me"];
  const assignees = normalizedAssigneeIds
    .map((id) => familyMembers.find((member) => member.id === id))
    .filter((member): member is FamilyMember => Boolean(member));

  if (assignees.length === 0) {
    return null;
  }

  const roles = Array.isArray(json.suggested_roles) ? json.suggested_roles.filter((role): role is string => typeof role === "string") : [];

  return {
    suggestedAssignees: assignees.map((member) => ({
      id: member.id,
      displayName: member.displayName,
      avatarSeed: member.avatarSeed,
      color: member.color
    })),
    suggestedRoles: roles,
    reason: readString(json.reason) || "DeepSeek 已根据任务内容生成指派建议",
    confidence: typeof json.confidence === "number" ? Math.max(0, Math.min(1, json.confidence)) : 0.8,
    displayTime: readString(json.display_time),
    personalTodo: json.personal_todo,
    taskTitle: readString(json.task_title) || normalizeTaskTitle(text),
    taskActionType: normalizeTaskActionType(json.task_action_type) || inferTaskActionType(text),
    taskOptions: Array.isArray(json.task_options) ? json.task_options.filter((option): option is string => typeof option === "string") : inferTaskOptions(text),
    source: "deepseek"
  };
}

function suggestLocalSuggestion(text: string, senderMemberId: string, mentionedMemberIds: string[], _contextTab: string, taskIntent: TaskIntent): AssignmentSuggestionWithSource {
  if (taskIntent.taskKind === "health_followup") {
    const subjectMember = resolveHealthSubjectMember(text) || familyMembers.find((member) => member.id === senderMemberId) || familyMembers[0];

    return {
      suggestedAssignees: [
        {
          id: subjectMember.id,
          displayName: subjectMember.displayName,
          avatarSeed: subjectMember.avatarSeed,
          color: subjectMember.color
        }
      ],
      suggestedRoles: [],
      reason: "检测到健康相关记录，已整理为需要跟进和记录结果的任务",
      confidence: taskIntent.confidence,
      displayTime: taskIntent.displayTime,
      dueAt: taskIntent.dueAt,
      sourceText: taskIntent.sourceText,
      personalTodo: false,
      taskTitle: taskIntent.title,
      taskActionType: taskIntent.taskActionType,
      taskOptions: taskIntent.options,
      source: "local"
    };
  }

  if (taskIntent.taskKind === "personal_todo") {
    const currentMember = familyMembers.find((member) => member.id === senderMemberId) || familyMembers[0];

    return {
      suggestedAssignees: [
        {
          id: currentMember.id,
          displayName: currentMember.displayName,
          avatarSeed: currentMember.avatarSeed,
          color: currentMember.color
        }
      ],
      suggestedRoles: [],
      reason: "整理为你的个人待办",
      confidence: 0.7,
      displayTime: taskIntent.displayTime,
      dueAt: taskIntent.dueAt,
      sourceText: taskIntent.sourceText,
      personalTodo: true,
      taskTitle: taskIntent.title,
      taskActionType: taskIntent.taskActionType,
      taskOptions: taskIntent.options,
      source: "local"
    };
  }

  const assignmentSuggestion = suggestAssignment(text, familyMembers, senderMemberId, mentionedMemberIds);
  const assigneeIds = assignmentSuggestion.suggestedAssignees.map((assignee) => assignee.id);

  return {
    ...assignmentSuggestion,
    taskTitle: taskIntent.title,
    displayTime: taskIntent.displayTime,
    dueAt: taskIntent.dueAt,
    sourceText: taskIntent.sourceText,
    personalTodo: assigneeIds.length === 1 && assigneeIds[0] === senderMemberId,
    taskActionType: taskIntent.taskActionType,
    taskOptions: taskIntent.options,
    source: "local"
  };
}

function suggestOpenVolunteerQuestion(_text: string, senderMemberId: string, taskIntent: TaskIntent): AssignmentSuggestionWithSource | null {
  if (taskIntent.taskKind !== "open_volunteer") {
    return null;
  }

  const assignees = familyMembers.filter((member) => member.id !== senderMemberId && member.relationshipRole !== "guest" && !member.householdRoles?.includes("assistant"));
  if (assignees.length === 0) {
    return null;
  }

  return {
    suggestedAssignees: assignees.map((member) => ({
      id: member.id,
      displayName: member.displayName,
      avatarSeed: member.avatarSeed,
      color: member.color
    })),
    suggestedRoles: [],
    reason: "这是开放报名问题，默认发给所有人回答愿意或不愿意",
    confidence: 0.92,
    displayTime: taskIntent.displayTime,
    dueAt: taskIntent.dueAt,
    sourceText: taskIntent.sourceText,
    personalTodo: false,
    taskTitle: taskIntent.title,
    taskActionType: taskIntent.taskActionType,
    taskOptions: taskIntent.options,
    source: "local"
  };
}

function resolveHealthSubjectMember(text: string) {
  return resolveFamilyMemberMention(text, familyMembers, { includeSelfPronouns: true });
}

function normalizeTaskActionType(value: unknown) {
  if (value === "text") {
    return "input";
  }
  if (value === "multi_select") {
    return "multiple_choice";
  }
  if (value === "approval" || value === "input" || value === "multiple_choice") {
    return value;
  }
  return undefined;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function validTimeZone(value: string) {
  if (!value) return "";
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return value;
  } catch {
    return "";
  }
}
