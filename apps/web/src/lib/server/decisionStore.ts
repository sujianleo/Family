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
import { createDecisionNotifications } from "./notificationStore";
import { createServiceSupabaseClient } from "./supabaseServer";
import { invokeDeepSeekJson } from "./langchainAi";
import { createAutomationRun, createRawEvent } from "./eventStore";
import type { FamilyRecord } from "../types";
import { familyRecords } from "../mockData";

type Context = { familyId: string; memberId: string };
type CreateInput = { roomRecordId: string; question: string; options: string[]; closesAt: string; sourceText?: string };
type UpdateInput = { question: string; options: string[]; closesAt: string };
const fallbackPath = "data/family-decisions.json";
const fallbackRecordsPath = "data/family-records.jsonl";

export async function listFamilyDecisions(context: Context, roomRecordId: string) {
  if (!roomRecordId) throw new Error("缺少群聊 ID。");
  const client = createServiceSupabaseClient() as any;
  if (!client || !context.familyId) {
    const room = await readFallbackRoomRecord(roomRecordId);
    assertRoomMember(room, context.memberId);
    return (await readFallback()).filter((item) => item.familyId === context.familyId && item.roomRecordId === roomRecordId).map((item) => sanitizeDecisionForViewer(item, context.memberId));
  }
  const { data, error } = await client.from("family_decisions").select("id").eq("family_id", context.familyId).eq("room_record_id", roomRecordId).order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  const results = await Promise.all((data || []).map((row: { id: string }) => getFamilyDecision(context, row.id)));
  return results.filter(Boolean) as FamilyDecision[];
}

export async function getFamilyDecision(context: Context, id: string) {
  const client = createServiceSupabaseClient() as any;
  if (!client || !context.familyId) {
    const decision = (await readFallback()).find((item) => item.id === id && (!context.familyId || item.familyId === context.familyId));
    if (!decision || !decision.participants.some((item) => item.memberId === context.memberId)) return null;
    return sanitizeDecisionForViewer(decision, context.memberId);
  }
  const { data: row, error } = await client.from("family_decisions").select("*").eq("id", id).eq("family_id", context.familyId).maybeSingle();
  if (error) throw error;
  if (!row) return null;
  const [{ data: optionRows }, { data: participantRows }, { data: ballotRows }, { data: messageRows }] = await Promise.all([
    client.from("family_decision_options").select("*").eq("decision_id", id).order("position"),
    client.from("family_decision_participants").select("member_id").eq("decision_id", id),
    client.from("family_decision_ballots").select("id,member_id,option_id,updated_at").eq("decision_id", id),
    client.from("family_decision_messages").select("id,member_id,body,message_type,metadata,created_at").eq("decision_id", id).order("created_at")
  ]);
  if (!(participantRows || []).some((item: any) => item.member_id === context.memberId)) return null;
  const decision = mapDecision(row, optionRows || [], participantRows || [], ballotRows || [], messageRows || []);
  return sanitizeDecisionForViewer(decision, context.memberId);
}

export async function createFamilyDecision(context: Context, input: CreateInput) {
  const roomRecordId = input.roomRecordId.trim();
  const question = input.question.trim().slice(0, 80);
  const options = [...new Set(input.options.map((item) => item.trim()).filter(Boolean))].slice(0, 8);
  const closesAt = new Date(input.closesAt);
  if (!roomRecordId) throw new Error("缺少群聊 ID。");
  if (!question || options.length < 2) throw new Error("家庭决定至少需要一个问题和两个选项。");
  if (Number.isNaN(closesAt.getTime()) || closesAt <= new Date()) throw new Error("截止时间必须晚于当前时间。");
  const client = createServiceSupabaseClient() as any;
  let decision: FamilyDecision;
  if (!client || !context.familyId) {
    const room = await readFallbackRoomRecord(roomRecordId);
    assertRoomMember(room, context.memberId);
    const participantIds = [...new Set([context.memberId, ...(room.chatMembers || [])].filter(Boolean))];
    if (participantIds.length < 2) throw new Error("群聊至少需要两名家庭成员才能发起投票。");
    decision = {
      id: crypto.randomUUID(), familyId: context.familyId || "local-family", roomRecordId, creatorMemberId: context.memberId || "me", question,
      status: "open", closesAt: closesAt.toISOString(), createdAt: new Date().toISOString(), summaryStatus: "pending",
      participants: participantIds.map((memberId) => ({ memberId, hasVoted: false })),
      options: options.map((label, position) => ({ id: crypto.randomUUID(), label, position })), ballots: [], messages: []
    };
    await mutateFallback((items) => [decision, ...items]);
  } else {
    const { data: createdId, error } = await client.rpc("create_family_decision", {
      target_family_id: context.familyId,
      target_room_record_id: roomRecordId,
      actor_member_id: context.memberId,
      decision_question: question,
      decision_closes_at: closesAt.toISOString(),
      decision_source_text: input.sourceText || "",
      option_labels: options
    });
    if (error) throw error;
    const created = await readSupabaseDecision(client, context.familyId, String(createdId));
    if (!created) throw new Error("家庭决定创建失败。");
    decision = created;
  }
  await createDecisionNotifications(context, decision.id, buildDecisionNotificationEvents(decision, "created"));
  await traceDecision(context, "decision_created", decision.id, question, { roomRecordId, participantMemberIds: decision.participants.map((item) => item.memberId), optionCount: options.length, sourceText: input.sourceText || "" });
  return sanitizeDecisionForViewer(decision, context.memberId);
}

export async function updateFamilyDecision(context: Context, id: string, input: UpdateInput) {
  const question = input.question.trim().slice(0, 80);
  const labels = [...new Set(input.options.map((item) => item.trim()).filter(Boolean))].slice(0, 8);
  const closesAt = new Date(input.closesAt);
  if (!question || labels.length < 2) throw new Error("投票至少需要一个问题和两个选项。");
  if (Number.isNaN(closesAt.getTime()) || closesAt <= new Date()) throw new Error("截止时间必须晚于当前时间。");
  const client = createServiceSupabaseClient() as any;
  let updated: FamilyDecision | undefined;
  if (!client || !context.familyId) {
    await mutateFallback((items) => items.map((item) => {
      if (item.id !== id) return item;
      assertCanEdit(item, context.memberId);
      updated = { ...item, question, closesAt: closesAt.toISOString(), options: labels.map((label, position) => ({ id: crypto.randomUUID(), label, position })) };
      return updated;
    }));
    if (!updated) throw new Error("投票不存在。");
  } else {
    const current = await readSupabaseDecision(client, context.familyId, id);
    if (!current) throw new Error("投票不存在。");
    assertCanEdit(current, context.memberId);
    const { error: updateError } = await client.from("family_decisions").update({ question, closes_at: closesAt.toISOString() }).eq("id", id).eq("status", "open");
    if (updateError) throw updateError;
    const { error: deleteError } = await client.from("family_decision_options").delete().eq("decision_id", id);
    if (deleteError) throw deleteError;
    const { error: insertError } = await client.from("family_decision_options").insert(labels.map((label, position) => ({ decision_id: id, label, position })));
    if (insertError) throw insertError;
    updated = await readSupabaseDecision(client, context.familyId, id) || undefined;
    if (!updated) throw new Error("投票修改失败。");
  }
  await traceDecision(context, "decision_updated", id, question, { optionCount: labels.length, closesAt: closesAt.toISOString() });
  return sanitizeDecisionForViewer(updated, context.memberId);
}

export async function voteFamilyDecision(context: Context, id: string, optionId: string) {
  const client = createServiceSupabaseClient() as any;
  if (!client || !context.familyId) {
    let updated: FamilyDecision | undefined;
    await mutateFallback((items) => items.map((decision) => {
      if (decision.id !== id) return decision;
      assertCanVote(decision, context.memberId, optionId);
      const current = decision.ballots.find((item) => item.memberId === context.memberId);
      const ballots = current ? decision.ballots.map((item) => item.memberId === context.memberId ? { ...item, optionId, updatedAt: new Date().toISOString() } : item) : [...decision.ballots, { id: crypto.randomUUID(), memberId: context.memberId, optionId, updatedAt: new Date().toISOString() }];
      const participants = decision.participants.map((item) => item.memberId === context.memberId ? { ...item, hasVoted: true } : item);
      updated = { ...decision, ballots, participants };
      return updated;
    }));
    if (!updated) throw new Error("家庭决定不存在。");
    const reason = shouldCloseDecision(updated);
    await traceDecision(context, "decision_voted", id, "", { optionId });
    if (reason) updated = await closeFamilyDecision(context, id, reason, true);
    return sanitizeDecisionForViewer(updated, context.memberId);
  }
  const full = await readSupabaseDecision(client, context.familyId, id);
  if (!full) throw new Error("家庭决定不存在。");
  assertCanVote(full, context.memberId, optionId);
  const { data: voteState, error } = await client.rpc("cast_family_decision_vote", { target_decision_id: id, actor_member_id: context.memberId, target_option_id: optionId });
  if (error) throw error;
  await traceDecision(context, "decision_voted", id, "", { optionId });
  const next = await readSupabaseDecision(client, context.familyId, id);
  if (!next) throw new Error("投票保存失败。");
  if (voteState === "all_voted") {
    await traceDecision(context, "decision_closed", id, next.question, { reason: "all_voted" });
    const summarized = await summarizeDecision(context, next);
    await createDecisionNotifications(context, id, buildDecisionNotificationEvents(summarized, "closed"));
    return sanitizeDecisionForViewer(summarized, context.memberId);
  }
  return sanitizeDecisionForViewer(next, context.memberId);
}

export async function addDecisionMessage(context: Context, id: string, input: Pick<FamilyDecisionMessage, "body" | "messageType" | "metadata">) {
  const body = input.body.trim();
  if (!body && input.messageType === "text") throw new Error("消息不能为空。");
  const client = createServiceSupabaseClient() as any;
  if (!client || !context.familyId) {
    const message: FamilyDecisionMessage = { id: crypto.randomUUID(), memberId: context.memberId, body, messageType: input.messageType, metadata: input.metadata, createdAt: new Date().toISOString() };
    let found = false;
    await mutateFallback((items) => items.map((decision) => {
      if (decision.id !== id || !decision.participants.some((item) => item.memberId === context.memberId)) return decision;
      found = true; return { ...decision, messages: [...decision.messages, message] };
    }));
    if (!found) throw new Error("无权参与该家庭决定。");
    await traceDecision(context, "decision_message_created", id, body, { messageId: message.id, messageType: input.messageType });
    return message;
  }
  const full = await readSupabaseDecision(client, context.familyId, id);
  if (!full?.participants.some((item) => item.memberId === context.memberId)) throw new Error("无权参与该家庭决定。");
  const { data, error } = await client.from("family_decision_messages").insert({ decision_id: id, member_id: context.memberId, body, message_type: input.messageType, metadata: input.metadata || {} }).select("*").single();
  if (error) throw error;
  await traceDecision(context, "decision_message_created", id, body, { messageId: data.id, messageType: input.messageType });
  return mapMessage(data);
}

export async function closeFamilyDecision(context: Context, id: string, reason: FamilyDecisionCloseReason = "creator", internal = false): Promise<FamilyDecision> {
  const client = createServiceSupabaseClient() as any;
  let decision: FamilyDecision;
  if (!client || !context.familyId) {
    let found: FamilyDecision | undefined;
    await mutateFallback((items) => items.map((item) => {
      if (item.id !== id) return item;
      if (!internal && item.creatorMemberId !== context.memberId) throw new Error("只有发起人可以提前结束。");
      found = { ...item, status: "closed", closeReason: reason, closedAt: new Date().toISOString() };
      return found;
    }));
    if (!found) throw new Error("家庭决定不存在。");
    decision = found;
  } else {
    const full = await readSupabaseDecision(client, context.familyId, id);
    if (!full) throw new Error("家庭决定不存在。");
    if (!internal && full.creatorMemberId !== context.memberId) throw new Error("只有发起人可以提前结束。");
    if (full.status === "closed") return full;
    const { error } = await client.from("family_decisions").update({ status: "closed", close_reason: reason, closed_at: new Date().toISOString() }).eq("id", id).eq("status", "open");
    if (error) throw error;
    decision = { ...full, status: "closed", closeReason: reason, closedAt: new Date().toISOString() };
  }
  decision = await summarizeDecision(context, decision);
  await createDecisionNotifications(context, id, buildDecisionNotificationEvents(decision, "closed"));
  await traceDecision(context, "decision_closed", id, decision.question, { reason });
  return decision;
}

export async function markDecisionAdopted(context: Context, id: string, taskId: string) {
  const client = createServiceSupabaseClient() as any;
  if (!client || !context.familyId) {
    let found = false;
    await mutateFallback((items) => items.map((item) => {
      if (item.id !== id || item.creatorMemberId !== context.memberId || item.status !== "closed") return item;
      if (item.adoptedTaskId) throw new Error("该方案已经创建过任务。");
      found = true; return { ...item, adoptedTaskId: taskId };
    }));
    if (!found) throw new Error("无权采纳该家庭决定。");
    await traceDecision(context, "decision_adopted", id, "", { taskId });
    return;
  }
  const decision = await readSupabaseDecision(client, context.familyId, id);
  if (!decision || decision.creatorMemberId !== context.memberId || decision.status !== "closed") throw new Error("无权采纳该家庭决定。");
  if (decision.adoptedTaskId) throw new Error("该方案已经创建过任务。");
  const { error } = await client.from("family_decisions").update({ adopted_task_id: taskId }).eq("id", id).is("adopted_task_id", null);
  if (error) throw error;
  await traceDecision(context, "decision_adopted", id, "", { taskId });
}

export async function closeDueFamilyDecisions(now = new Date()) {
  const client = createServiceSupabaseClient() as any;
  if (!client) {
    const due = (await readFallback()).filter((item) => item.status === "open" && new Date(item.closesAt) <= now);
    for (const item of due) await closeFamilyDecision({ familyId: item.familyId, memberId: item.creatorMemberId }, item.id, "deadline", true);
    return due.map((item) => item.id);
  }
  const { data, error } = await client.from("family_decisions").select("id,family_id,creator_member_id").eq("status", "open").lte("closes_at", now.toISOString()).limit(100);
  if (error) throw error;
  for (const item of data || []) await closeFamilyDecision({ familyId: item.family_id, memberId: item.creator_member_id }, item.id, "deadline", true);
  return (data || []).map((item: { id: string }) => item.id);
}

async function summarizeDecision(context: Context, decision: FamilyDecision) {
  const result = buildDecisionResult(decision);
  const fallback = result.totalVotes ? `共 ${result.totalVotes} 人参与。${result.isTie ? "未形成唯一多数。" : `推荐方案：${result.recommendation}。`}` : "暂时没有成员投票。";
  let summaryText = fallback;
  let summaryStatus: "ready" | "failed" = "ready";
  try {
    const response = await invokeDeepSeekJson([
      ["system", "你是家庭决定总结助手。仅根据给定投票和讨论总结，不发明事实。输出 JSON：{summary:string}。平票必须明确说未形成唯一多数。"],
      ["user", JSON.stringify({ question: decision.question, result, messages: decision.messages.map((item) => ({ memberId: item.memberId, body: item.body })) })]
    ], { familyId: context.familyId, maxTokens: 400, operation: "decision.summary", temperature: 0.1, timeoutMs: 5000 });
    if (response && typeof response === "object" && typeof (response as { summary?: unknown }).summary === "string") summaryText = (response as { summary: string }).summary.trim() || fallback;
    else { summaryStatus = "failed"; summaryText = `AI 总结暂不可用。${fallback}`; }
  } catch { summaryStatus = "failed"; }
  const next = { ...decision, options: result.options, summaryStatus, summaryText, summaryJson: result };
  const client = createServiceSupabaseClient() as any;
  if (client && context.familyId) await client.from("family_decisions").update({ summary_status: summaryStatus, summary_text: summaryText, summary_json: result }).eq("id", decision.id);
  else await mutateFallback((items) => items.map((item) => item.id === decision.id ? next : item));
  await createAutomationRun({ actionId: "decision.summary.generate", familyId: context.familyId, input: { decisionId: decision.id }, output: { result, summaryText }, promptVersion: "decision-summary-v1", requiresConfirmation: false, sideEffectLevel: "low", status: summaryStatus === "ready" ? "success" : "failed" }).catch(() => undefined);
  return next;
}

async function readSupabaseDecision(client: any, familyId: string, id: string): Promise<FamilyDecision | null> {
  const { data: row } = await client.from("family_decisions").select("*").eq("id", id).eq("family_id", familyId).maybeSingle();
  if (!row) return null;
  const [{ data: options }, { data: participants }, { data: ballots }, { data: messages }] = await Promise.all([
    client.from("family_decision_options").select("*").eq("decision_id", id).order("position"),
    client.from("family_decision_participants").select("member_id").eq("decision_id", id),
    client.from("family_decision_ballots").select("*").eq("decision_id", id),
    client.from("family_decision_messages").select("*").eq("decision_id", id).order("created_at")
  ]);
  return mapDecision(row, options || [], participants || [], ballots || [], messages || []);
}

function mapDecision(row: any, options: any[], participants: any[], ballots: any[], messages: any[]): FamilyDecision {
  return {
    id: row.id, familyId: row.family_id, roomRecordId: row.room_record_id, creatorMemberId: row.creator_member_id, question: row.question, status: row.status,
    closesAt: row.closes_at, createdAt: row.created_at, closedAt: row.closed_at || undefined, closeReason: row.close_reason || undefined,
    summaryStatus: row.summary_status, summaryText: row.summary_text || undefined, summaryJson: row.summary_json || undefined, adoptedTaskId: row.adopted_task_id || undefined,
    participants: participants.map((item) => ({ memberId: item.member_id, hasVoted: ballots.some((ballot) => ballot.member_id === item.member_id) })),
    options: options.map((item) => ({ id: item.id, label: item.label, description: item.description || undefined, icon: item.icon || undefined, position: item.position })),
    ballots: ballots.map((item) => ({ id: item.id, memberId: item.member_id, optionId: item.option_id, updatedAt: item.updated_at })),
    messages: messages.map(mapMessage)
  };
}

function mapMessage(item: any): FamilyDecisionMessage { return { id: item.id, memberId: item.member_id, body: item.body, messageType: item.message_type, metadata: item.metadata || {}, createdAt: item.created_at }; }
function assertCanVote(decision: FamilyDecision, memberId: string, optionId: string) {
  if (decision.status !== "open" || new Date(decision.closesAt) <= new Date()) throw new Error("家庭决定已经结束。");
  if (!decision.participants.some((item) => item.memberId === memberId)) throw new Error("无权参与该家庭决定。");
  if (!decision.options.some((item) => item.id === optionId)) throw new Error("选项不属于该家庭决定。");
}
function assertCanEdit(decision: FamilyDecision, memberId: string) {
  if (decision.creatorMemberId !== memberId) throw new Error("只有发起者可以修改投票。");
  if (decision.status !== "open") throw new Error("已结束的投票不能修改。");
  if (decision.ballots.length > 0) throw new Error("已经有人投票，不能再修改内容。");
}
async function readFallback(): Promise<FamilyDecision[]> { try { return JSON.parse(await readFile(fallbackPath, "utf8")) as FamilyDecision[]; } catch { return []; } }
async function readFallbackRoomRecord(roomRecordId: string): Promise<FamilyRecord | null> {
  const builtInRoom = familyRecords.find((record) => record.id === roomRecordId && Boolean(record.inviteLink)) || null;
  try {
    const lines = (await readFile(fallbackRecordsPath, "utf8")).split("\n").filter(Boolean);
    let match: FamilyRecord | null = null;
    for (const line of lines) {
      const parsed = JSON.parse(line) as { record?: FamilyRecord } & Partial<FamilyRecord>;
      const record = parsed.record || (parsed as FamilyRecord);
      if (record?.id === roomRecordId) match = record;
    }
    return match || builtInRoom;
  } catch {
    return builtInRoom;
  }
}
function assertRoomMember(room: FamilyRecord | null, memberId: string): asserts room is FamilyRecord {
  if (!room?.inviteLink || !room.tags.some((tag) => tag === "群组" || tag === "群聊")) throw new Error("群聊不存在。");
  if (!room.chatMembers?.includes(memberId)) throw new Error("你不是该群聊成员。");
}
async function mutateFallback(change: (items: FamilyDecision[]) => FamilyDecision[]) { const items = change(await readFallback()); await mkdir("data", { recursive: true }); await writeFile(fallbackPath, JSON.stringify(items, null, 2), "utf8"); }
async function traceDecision(context: Context, eventType: string, decisionId: string, rawText: string, metadata: Record<string, unknown>) {
  await createRawEvent({ actorMemberId: context.memberId, familyId: context.familyId, rawText, rawPayload: { decisionId, eventType, ...metadata }, sourceType: eventType === "decision_message_created" ? "group_chat" : "meta_event" }).catch(() => undefined);
}
