import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  buildDecisionNotificationEvents,
  buildDecisionResult,
  sanitizeDecisionForViewer,
  shouldCloseDecision,
  type FamilyDecision,
  type FamilyDecisionCloseReason,
  type FamilyDecisionMessage
} from "../familyDecisions";
import { familyRecords } from "../mockData";
import type { FamilyRecord } from "../types";
import { createAutomationRun, createRawEvent } from "./eventStore";
import { invokeDeepSeekJson } from "./langchainAi";
import { listLiteFamilyRecords } from "./liteRepository";
import { createDecisionNotifications } from "./notificationStore";

type Context = { familyId: string; memberId: string };
type CreateInput = { roomRecordId: string; question: string; options: string[]; closesAt: string; sourceText?: string };
type UpdateInput = { question: string; options: string[]; closesAt: string };
const decisionsPath = "data/family-decisions.json";

export async function listFamilyDecisions(context: Context, roomRecordId: string) {
  if (!roomRecordId) throw new Error("缺少群聊 ID。");
  const room = readRoomRecord(context.familyId, roomRecordId);
  assertRoomMember(room, context.memberId);
  return (await readDecisions())
    .filter((item) => item.familyId === context.familyId && item.roomRecordId === roomRecordId)
    .map((item) => sanitizeDecisionForViewer(item, context.memberId));
}

export async function getFamilyDecision(context: Context, id: string) {
  const decision = (await readDecisions()).find(
    (item) => item.id === id && (!context.familyId || item.familyId === context.familyId)
  );
  if (!decision || !decision.participants.some((item) => item.memberId === context.memberId)) return null;
  return sanitizeDecisionForViewer(decision, context.memberId);
}

export async function createFamilyDecision(context: Context, input: CreateInput) {
  const roomRecordId = input.roomRecordId.trim();
  const question = input.question.trim().slice(0, 80);
  const options = [...new Set(input.options.map((item) => item.trim()).filter(Boolean))].slice(0, 8);
  const closesAt = new Date(input.closesAt);
  if (!roomRecordId) throw new Error("缺少群聊 ID。");
  if (!question || options.length < 2) throw new Error("家庭决定至少需要一个问题和两个选项。");
  if (Number.isNaN(closesAt.getTime()) || closesAt <= new Date()) {
    throw new Error("截止时间必须晚于当前时间。");
  }

  const room = readRoomRecord(context.familyId, roomRecordId);
  assertRoomMember(room, context.memberId);
  const participantIds = [...new Set([context.memberId, ...(room.chatMembers || [])].filter(Boolean))];
  if (participantIds.length < 2) throw new Error("群聊至少需要两名家庭成员才能发起投票。");
  const decision: FamilyDecision = {
    ballots: [],
    closesAt: closesAt.toISOString(),
    createdAt: new Date().toISOString(),
    creatorMemberId: context.memberId || "me",
    familyId: context.familyId || "local-family",
    id: crypto.randomUUID(),
    messages: [],
    options: options.map((label, position) => ({ id: crypto.randomUUID(), label, position })),
    participants: participantIds.map((memberId) => ({ memberId, hasVoted: false })),
    question,
    roomRecordId,
    status: "open",
    summaryStatus: "pending"
  };
  await mutateDecisions((items) => [decision, ...items]);
  await createDecisionNotifications(context, decision.id, buildDecisionNotificationEvents(decision, "created"));
  await traceDecision(context, "decision_created", decision.id, question, {
    optionCount: options.length,
    participantMemberIds: participantIds,
    roomRecordId,
    sourceText: input.sourceText || ""
  });
  return sanitizeDecisionForViewer(decision, context.memberId);
}

export async function updateFamilyDecision(context: Context, id: string, input: UpdateInput) {
  const question = input.question.trim().slice(0, 80);
  const labels = [...new Set(input.options.map((item) => item.trim()).filter(Boolean))].slice(0, 8);
  const closesAt = new Date(input.closesAt);
  if (!question || labels.length < 2) throw new Error("投票至少需要一个问题和两个选项。");
  if (Number.isNaN(closesAt.getTime()) || closesAt <= new Date()) {
    throw new Error("截止时间必须晚于当前时间。");
  }
  let updated: FamilyDecision | undefined;
  await mutateDecisions((items) => items.map((item) => {
    if (item.id !== id || item.familyId !== context.familyId) return item;
    assertCanEdit(item, context.memberId);
    updated = {
      ...item,
      closesAt: closesAt.toISOString(),
      options: labels.map((label, position) => ({ id: crypto.randomUUID(), label, position })),
      question
    };
    return updated;
  }));
  if (!updated) throw new Error("投票不存在。");
  await traceDecision(context, "decision_updated", id, question, {
    closesAt: closesAt.toISOString(),
    optionCount: labels.length
  });
  return sanitizeDecisionForViewer(updated, context.memberId);
}

export async function voteFamilyDecision(context: Context, id: string, optionId: string) {
  let updated: FamilyDecision | undefined;
  await mutateDecisions((items) => items.map((decision) => {
    if (decision.id !== id || decision.familyId !== context.familyId) return decision;
    assertCanVote(decision, context.memberId, optionId);
    const current = decision.ballots.find((item) => item.memberId === context.memberId);
    const ballots = current
      ? decision.ballots.map((item) => item.memberId === context.memberId
        ? { ...item, optionId, updatedAt: new Date().toISOString() }
        : item)
      : [...decision.ballots, {
          id: crypto.randomUUID(),
          memberId: context.memberId,
          optionId,
          updatedAt: new Date().toISOString()
        }];
    const participants = decision.participants.map((item) => item.memberId === context.memberId
      ? { ...item, hasVoted: true }
      : item);
    updated = { ...decision, ballots, participants };
    return updated;
  }));
  if (!updated) throw new Error("家庭决定不存在。");
  await traceDecision(context, "decision_voted", id, "", { optionId });
  const reason = shouldCloseDecision(updated);
  if (reason) updated = await closeFamilyDecision(context, id, reason, true);
  return sanitizeDecisionForViewer(updated, context.memberId);
}

export async function addDecisionMessage(
  context: Context,
  id: string,
  input: Pick<FamilyDecisionMessage, "body" | "messageType" | "metadata">
) {
  const body = input.body.trim();
  if (!body && input.messageType === "text") throw new Error("消息不能为空。");
  const message: FamilyDecisionMessage = {
    body,
    createdAt: new Date().toISOString(),
    id: crypto.randomUUID(),
    memberId: context.memberId,
    messageType: input.messageType,
    metadata: input.metadata
  };
  let found = false;
  await mutateDecisions((items) => items.map((decision) => {
    if (
      decision.id !== id
      || decision.familyId !== context.familyId
      || !decision.participants.some((item) => item.memberId === context.memberId)
    ) return decision;
    found = true;
    return { ...decision, messages: [...decision.messages, message] };
  }));
  if (!found) throw new Error("无权参与该家庭决定。");
  await traceDecision(context, "decision_message_created", id, body, {
    messageId: message.id,
    messageType: input.messageType
  });
  return message;
}

export async function closeFamilyDecision(
  context: Context,
  id: string,
  reason: FamilyDecisionCloseReason = "creator",
  internal = false
): Promise<FamilyDecision> {
  let decision: FamilyDecision | undefined;
  await mutateDecisions((items) => items.map((item) => {
    if (item.id !== id || item.familyId !== context.familyId) return item;
    if (!internal && item.creatorMemberId !== context.memberId) {
      throw new Error("只有发起人可以提前结束。");
    }
    decision = item.status === "closed"
      ? item
      : { ...item, closeReason: reason, closedAt: new Date().toISOString(), status: "closed" };
    return decision;
  }));
  if (!decision) throw new Error("家庭决定不存在。");
  decision = await summarizeDecision(context, decision);
  await createDecisionNotifications(context, id, buildDecisionNotificationEvents(decision, "closed"));
  await traceDecision(context, "decision_closed", id, decision.question, { reason });
  return decision;
}

export async function markDecisionAdopted(context: Context, id: string, taskId: string) {
  let found = false;
  await mutateDecisions((items) => items.map((item) => {
    if (
      item.id !== id
      || item.familyId !== context.familyId
      || item.creatorMemberId !== context.memberId
      || item.status !== "closed"
    ) return item;
    if (item.adoptedTaskId) throw new Error("该方案已经创建过任务。");
    found = true;
    return { ...item, adoptedTaskId: taskId };
  }));
  if (!found) throw new Error("无权采纳该家庭决定。");
  await traceDecision(context, "decision_adopted", id, "", { taskId });
}

export async function closeDueFamilyDecisions(now = new Date(), familyId = "") {
  const due = (await readDecisions()).filter(
    (item) => (!familyId || item.familyId === familyId)
      && item.status === "open"
      && new Date(item.closesAt) <= now
  );
  for (const item of due) {
    await closeFamilyDecision(
      { familyId: item.familyId, memberId: item.creatorMemberId },
      item.id,
      "deadline",
      true
    );
  }
  return due.map((item) => item.id);
}

async function summarizeDecision(context: Context, decision: FamilyDecision) {
  const result = buildDecisionResult(decision);
  const fallback = result.totalVotes
    ? `共 ${result.totalVotes} 人参与。${result.isTie ? "未形成唯一多数。" : `推荐方案：${result.recommendation}。`}`
    : "暂时没有成员投票。";
  let summaryText = fallback;
  let summaryStatus: "ready" | "failed" = "ready";
  try {
    const response = await invokeDeepSeekJson([
      ["system", "你是家庭决定总结助手。仅根据给定投票和讨论总结，不发明事实。输出 JSON：{summary:string}。平票必须明确说未形成唯一多数。"],
      ["user", JSON.stringify({
        messages: decision.messages.map((item) => ({ body: item.body, memberId: item.memberId })),
        question: decision.question,
        result
      })]
    ], {
      familyId: context.familyId,
      maxTokens: 400,
      operation: "decision.summary",
      temperature: 0.1,
      timeoutMs: 5000
    });
    if (response && typeof response === "object" && typeof (response as { summary?: unknown }).summary === "string") {
      summaryText = (response as { summary: string }).summary.trim() || fallback;
    } else {
      summaryStatus = "failed";
      summaryText = `AI 总结暂不可用。${fallback}`;
    }
  } catch {
    summaryStatus = "failed";
  }
  const next = { ...decision, options: result.options, summaryJson: result, summaryStatus, summaryText };
  await mutateDecisions((items) => items.map((item) => item.id === decision.id ? next : item));
  await createAutomationRun({
    actionId: "decision.summary.generate",
    familyId: context.familyId,
    input: { decisionId: decision.id },
    output: { result, summaryText },
    promptVersion: "decision-summary-v1",
    requiresConfirmation: false,
    sideEffectLevel: "low",
    status: summaryStatus === "ready" ? "success" : "failed"
  }).catch(() => undefined);
  return next;
}

function assertCanVote(decision: FamilyDecision, memberId: string, optionId: string) {
  if (decision.status !== "open" || new Date(decision.closesAt) <= new Date()) {
    throw new Error("家庭决定已经结束。");
  }
  if (!decision.participants.some((item) => item.memberId === memberId)) {
    throw new Error("无权参与该家庭决定。");
  }
  if (!decision.options.some((item) => item.id === optionId)) {
    throw new Error("选项不属于该家庭决定。");
  }
}

function assertCanEdit(decision: FamilyDecision, memberId: string) {
  if (decision.creatorMemberId !== memberId) throw new Error("只有发起者可以修改投票。");
  if (decision.status !== "open") throw new Error("已结束的投票不能修改。");
  if (decision.ballots.length > 0) throw new Error("已经有人投票，不能再修改内容。");
}

async function readDecisions(): Promise<FamilyDecision[]> {
  try {
    return JSON.parse(await readFile(decisionsPath, "utf8")) as FamilyDecision[];
  } catch {
    return [];
  }
}

function readRoomRecord(familyId: string, roomRecordId: string): FamilyRecord | null {
  return listLiteFamilyRecords(familyId, 500).find((record) => record.id === roomRecordId)
    || familyRecords.find((record) => record.id === roomRecordId && Boolean(record.inviteLink))
    || null;
}

function assertRoomMember(room: FamilyRecord | null, memberId: string): asserts room is FamilyRecord {
  if (!room?.inviteLink || !room.tags.some((tag) => tag === "群组" || tag === "群聊")) {
    throw new Error("群聊不存在。");
  }
  if (!room.chatMembers?.includes(memberId)) throw new Error("你不是该群聊成员。");
}

async function mutateDecisions(change: (items: FamilyDecision[]) => FamilyDecision[]) {
  const items = change(await readDecisions());
  await mkdir("data", { recursive: true });
  await writeFile(decisionsPath, JSON.stringify(items, null, 2), "utf8");
}

async function traceDecision(
  context: Context,
  eventType: string,
  decisionId: string,
  rawText: string,
  metadata: Record<string, unknown>
) {
  await createRawEvent({
    actorMemberId: context.memberId,
    familyId: context.familyId,
    rawPayload: { decisionId, eventType, ...metadata },
    rawText,
    sourceType: eventType === "decision_message_created" ? "group_chat" : "meta_event"
  }).catch(() => undefined);
}
