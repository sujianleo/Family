import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  buildGroupJudgementTally,
  buildNeutralJudgementSummary,
  isEligibleJudgementMember,
  sanitizeGroupJudgementForViewer,
  type GroupJudgement,
  type GroupJudgementStance,
  type JudgementStance
} from "../groupJudgement";
import { familyMembers, familyRecords } from "../mockData";
import type { FamilyRecord } from "../types";
import { createAutomationRun, createRawEvent } from "./eventStore";
import { invokeDeepSeekJson } from "./langchainAi";
import { createServiceSupabaseClient } from "./supabaseServer";

type Context = { familyId: string; memberId: string };
type CreateInput = {
  endsAt?: string;
  leftLabel: string;
  leftMemberId?: string;
  rightLabel: string;
  rightMemberId?: string;
  roomRecordId: string;
  spaceId?: string;
  statement: string;
  title: string;
};

export type GroupJudgementDraft = {
  leftLabel: string;
  rightLabel: string;
  statement: string;
  title: string;
};

const fallbackPath = "data/group-judgements.json";
const fallbackRecordsPath = "data/family-records.jsonl";

export async function listGroupJudgements(context: Context, roomRecordId: string) {
  if (!roomRecordId) throw new Error("缺少群聊 ID。");
  const client = createServiceSupabaseClient() as any;
  if (!client || !isUuid(context.familyId)) {
    const room = await readFallbackRoomRecord(roomRecordId);
    assertFallbackRoomMember(room, context.memberId);
    await closeExpiredFallbackJudgements(roomRecordId);
    return (await readFallback()).filter((item) => item.familyId === (context.familyId || "local-family") && item.roomRecordId === roomRecordId).map((item) => sanitizeGroupJudgementForViewer(item, context.memberId));
  }
  await assertSupabaseRoomMember(client, context, roomRecordId);
  await closeExpiredSupabaseJudgements(client, context.familyId, roomRecordId);
  const { data, error } = await client.from("family_judgements").select("*").eq("family_id", context.familyId).eq("room_record_id", roomRecordId).order("created_at", { ascending: false }).limit(20);
  if (error) throw error;
  return Promise.all((data || []).map(async (row: any) => sanitizeGroupJudgementForViewer(await readSupabaseJudgement(client, row), context.memberId)));
}

export async function getGroupJudgement(context: Context, id: string) {
  const client = createServiceSupabaseClient() as any;
  if (!client || !isUuid(context.familyId)) {
    const judgement = (await readFallback()).find((item) => item.id === id && item.familyId === (context.familyId || "local-family"));
    if (!judgement) return null;
    const room = await readFallbackRoomRecord(judgement.roomRecordId);
    assertFallbackRoomMember(room, context.memberId);
    return sanitizeGroupJudgementForViewer(judgement, context.memberId);
  }
  const { data, error } = await client.from("family_judgements").select("*").eq("id", id).eq("family_id", context.familyId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  await assertSupabaseRoomMember(client, context, data.room_record_id);
  return sanitizeGroupJudgementForViewer(await readSupabaseJudgement(client, data), context.memberId);
}

export async function createGroupJudgement(context: Context, input: CreateInput) {
  const normalized = normalizeCreateInput(input);
  const client = createServiceSupabaseClient() as any;
  let judgement: GroupJudgement;
  if (!client || !isUuid(context.familyId)) {
    const room = await readFallbackRoomRecord(normalized.roomRecordId);
    assertFallbackRoomMember(room, context.memberId);
    const existing = (await readFallback()).find((item) => item.roomRecordId === normalized.roomRecordId && item.status === "active");
    if (existing) throw new Error("当前群聊已有进行中的评评理。");
    const eligibleIds = getFallbackEligibleMemberIds(room);
    assertSideMembers(eligibleIds, normalized.leftMemberId, normalized.rightMemberId);
    judgement = {
      ...normalized,
      createdAt: new Date().toISOString(),
      creatorMemberId: context.memberId,
      familyId: context.familyId || "local-family",
      id: crypto.randomUUID(),
      stances: [],
      status: "active"
    };
    await mutateFallback((items) => [judgement, ...items]);
  } else {
    const room = await assertSupabaseRoomMember(client, context, normalized.roomRecordId);
    const eligibleIds = await getSupabaseEligibleMemberIds(client, context.familyId, room);
    assertSideMembers(eligibleIds, normalized.leftMemberId, normalized.rightMemberId);
    const { data, error } = await client.from("family_judgements").insert({
      creator_member_id: context.memberId,
      ends_at: normalized.endsAt || null,
      family_id: context.familyId,
      left_label: normalized.leftLabel,
      left_member_id: normalized.leftMemberId || null,
      right_label: normalized.rightLabel,
      right_member_id: normalized.rightMemberId || null,
      room_record_id: normalized.roomRecordId,
      space_id: normalized.spaceId || room.space_id || null,
      statement: normalized.statement,
      title: normalized.title
    }).select("*").single();
    if (error) {
      if (error.code === "23505") throw new Error("当前群聊已有进行中的评评理。");
      throw error;
    }
    judgement = await readSupabaseJudgement(client, data);
  }
  await trace(context, "group_judgement_created", judgement, { title: judgement.title });
  return judgement;
}

export async function setGroupJudgementStance(context: Context, id: string, stance: JudgementStance) {
  if (!(["left", "right", "neutral", "undecided"] as string[]).includes(stance)) throw new Error("立场无效。");
  return upsertStance(context, id, stance, "manual");
}

export async function draftGroupJudgement(context: Context, input: { roomRecordId: string; statement: string }): Promise<GroupJudgementDraft> {
  const statement = input.statement.trim().slice(0, 1200);
  if (statement.length < 10) throw new Error("请先完整陈述事情经过。");
  const client = createServiceSupabaseClient() as any;
  if (!client || !isUuid(context.familyId)) {
    const room = await readFallbackRoomRecord(input.roomRecordId);
    assertFallbackRoomMember(room, context.memberId);
  } else {
    await assertSupabaseRoomMember(client, context, input.roomRecordId);
  }
  const result = await invokeDeepSeekJson([
    ["system", "你是中立的争议整理助手。只把发起者陈述整理成一个可确认的争议问题和两种对称观点，不判断事实真伪，不裁决，不替任何人选择立场。输出 JSON：{title:string,leftLabel:string,rightLabel:string}。标签要短、平行、中性。"],
    ["user", statement]
  ], { familyId: context.familyId, maxTokens: 260, operation: "group-judgement.draft", temperature: 0.1, timeoutMs: 6000 });
  const raw = result as Record<string, unknown> | null;
  const title = typeof raw?.title === "string" ? raw.title.trim().slice(0, 80) : "";
  const leftLabel = typeof raw?.leftLabel === "string" ? raw.leftLabel.trim().slice(0, 30) : "";
  const rightLabel = typeof raw?.rightLabel === "string" ? raw.rightLabel.trim().slice(0, 30) : "";
  if (!title || !leftLabel || !rightLabel || leftLabel === rightLabel) throw new Error("AI 暂时无法整理出清晰的双方观点，请补充事实后重试。");
  const draft = { leftLabel, rightLabel, statement, title };
  await createAutomationRun({
    actionId: "group-judgement.draft",
    familyId: context.familyId,
    input: { roomRecordId: input.roomRecordId, statement },
    output: draft,
    promptVersion: "group-judgement-draft-v1",
    requiresConfirmation: true,
    sideEffectLevel: "none",
    status: "success"
  }).catch(() => undefined);
  return draft;
}

export async function confirmSuggestedJudgementStance(context: Context, id: string, stance: JudgementStance) {
  if (!(["left", "right", "neutral", "undecided"] as string[]).includes(stance)) throw new Error("立场无效。");
  return upsertStance(context, id, stance, "ai_confirmed");
}

export async function dismissSuggestedJudgementStance(context: Context, id: string) {
  const judgement = await requireActiveJudgement(context, id);
  const client = createServiceSupabaseClient() as any;
  if (!client || !isUuid(context.familyId)) {
    await mutateFallback((items) => items.map((item) => item.id === id ? { ...item, stances: item.stances.filter((entry) => entry.memberId !== context.memberId || entry.source !== "ai_suggested") } : item));
  } else {
    const { error } = await client.from("family_judgement_stances").delete().eq("judgement_id", id).eq("member_id", context.memberId).eq("source", "ai_suggested");
    if (error) throw error;
  }
  await trace(context, "group_judgement_suggestion_dismissed", judgement, {});
  return getGroupJudgement(context, id);
}

export async function suggestGroupJudgementStance(context: Context, id: string, input: { messageId: string; text: string }) {
  const judgement = await requireActiveJudgement(context, id);
  const existing = judgement.stances.find((item) => item.memberId === context.memberId && item.source !== "ai_suggested");
  if (existing || !input.text.trim()) return judgement;
  let candidate: { confidence: number; evidence: string; stance: JudgementStance } | null = null;
  try {
    const result = await invokeDeepSeekJson([
      ["system", "你只识别说话者本人对当前二选一议题的候选立场，不裁决、不替用户投票。必须排除引用、转述、反话、玩笑和明显不确定表达。输出 JSON：{stance:'left'|'right'|'neutral'|'undecided',confidence:0..1,evidence:string,isExplicit:boolean,isQuoteOrJoke:boolean,isUncertain:boolean}。含糊时必须 undecided。"],
      ["user", JSON.stringify({ left: judgement.leftLabel, message: input.text, question: judgement.title, right: judgement.rightLabel })]
    ], { familyId: context.familyId, maxTokens: 180, operation: "group-judgement.stance-suggest", temperature: 0, timeoutMs: 5000 });
    const raw = result as Record<string, unknown> | null;
    const stance = typeof raw?.stance === "string" ? raw.stance : "";
    const confidence = typeof raw?.confidence === "number" ? Math.max(0, Math.min(1, raw.confidence)) : 0;
    const isExplicit = raw?.isExplicit === true;
    const isQuoteOrJoke = raw?.isQuoteOrJoke === true;
    const isUncertain = raw?.isUncertain === true;
    if ((stance === "left" || stance === "right" || stance === "neutral") && confidence >= 0.45 && isExplicit && !isQuoteOrJoke && !isUncertain) {
      candidate = { confidence, evidence: typeof raw?.evidence === "string" ? raw.evidence.slice(0, 160) : input.text.slice(0, 160), stance: stance as JudgementStance };
    }
  } catch {
    candidate = null;
  }
  await createAutomationRun({
    actionId: "group-judgement.stance-suggest",
    familyId: context.familyId,
    input: { judgementId: id, messageId: input.messageId },
    output: candidate || { skipped: true },
    promptVersion: "group-judgement-stance-v1",
    requiresConfirmation: true,
    sideEffectLevel: "low",
    status: candidate ? "success" : "failed"
  }).catch(() => undefined);
  if (!candidate) return judgement;
  return upsertStance(context, id, candidate.stance, "ai_suggested", { confidence: candidate.confidence, evidenceMessageId: input.messageId, evidenceText: candidate.evidence });
}

export async function closeGroupJudgement(context: Context, id: string) {
  const judgement = await requireActiveJudgement(context, id);
  if (judgement.creatorMemberId !== context.memberId) throw new Error("只有发起人可以结束评评理。");
  const closedAt = new Date().toISOString();
  const neutralSummary = buildNeutralJudgementSummary(judgement);
  const client = createServiceSupabaseClient() as any;
  let next: GroupJudgement = { ...judgement, closeReason: "creator", closedAt, neutralSummary, status: "closed" };
  if (!client || !isUuid(context.familyId)) {
    await mutateFallback((items) => items.map((item) => item.id === id ? next : item));
  } else {
    const { data, error } = await client.from("family_judgements").update({ close_reason: "creator", closed_at: closedAt, neutral_summary: neutralSummary, status: "closed" }).eq("id", id).eq("status", "active").select("*").single();
    if (error) throw error;
    next = await readSupabaseJudgement(client, data);
  }
  await trace(context, "group_judgement_closed", next, { neutralSummary });
  return next;
}

export async function extendGroupJudgement(context: Context, id: string, minutes = 120) {
  const judgement = await getGroupJudgement(context, id);
  if (!judgement) throw new Error("评评理不存在。");
  if (judgement.creatorMemberId !== context.memberId) throw new Error("只有发起人可以延长时间。");
  if (judgement.status !== "closed") throw new Error("只有已结束的评评理可以延长。");
  const endsAt = new Date(Date.now() + Math.max(30, Math.min(1440, minutes)) * 60_000).toISOString();
  const client = createServiceSupabaseClient() as any;
  let next: GroupJudgement = { ...judgement, closeReason: undefined, closedAt: undefined, endsAt, neutralSummary: undefined, resolvedStance: undefined, resolutionKind: undefined, status: "active" };
  if (!client || !isUuid(context.familyId)) {
    const conflict = (await readFallback()).some((item) => item.roomRecordId === judgement.roomRecordId && item.id !== id && item.status === "active");
    if (conflict) throw new Error("当前群聊已有进行中的评评理。");
    await mutateFallback((items) => items.map((item) => item.id === id ? next : item));
  } else {
    const { data, error } = await client.from("family_judgements").update({ close_reason: null, closed_at: null, ends_at: endsAt, neutral_summary: "", resolved_stance: null, resolution_kind: null, status: "active" }).eq("id", id).eq("status", "closed").select("*").single();
    if (error) {
      if (error.code === "23505") throw new Error("当前群聊已有进行中的评评理。");
      throw error;
    }
    next = await readSupabaseJudgement(client, data);
  }
  await trace(context, "group_judgement_extended", next, { endsAt });
  return sanitizeGroupJudgementForViewer(next, context.memberId);
}

export async function resolveGroupJudgementTie(context: Context, id: string, stance: "left" | "right") {
  const judgement = await getGroupJudgement(context, id);
  if (!judgement) throw new Error("评评理不存在。");
  if (judgement.creatorMemberId !== context.memberId) throw new Error("只有发起人可以作出最终选择。");
  if (judgement.status !== "closed") throw new Error("请先结束评评理。");
  if (buildGroupJudgementTally(judgement.stances).result !== "tie") throw new Error("只有平局时才需要发起人作出最终选择。");
  const tally = buildNeutralJudgementSummary(judgement);
  const label = stance === "left" ? judgement.leftLabel : judgement.rightLabel;
  const neutralSummary = `${tally} 发起人最终选择：${label}。`;
  const client = createServiceSupabaseClient() as any;
  let next: GroupJudgement = { ...judgement, neutralSummary, resolutionKind: "creator", resolvedStance: stance };
  if (!client || !isUuid(context.familyId)) {
    await mutateFallback((items) => items.map((item) => item.id === id ? next : item));
  } else {
    const { data, error } = await client.from("family_judgements").update({ neutral_summary: neutralSummary, resolution_kind: "creator", resolved_stance: stance }).eq("id", id).eq("status", "closed").select("*").single();
    if (error) throw error;
    next = await readSupabaseJudgement(client, data);
  }
  await trace(context, "group_judgement_creator_resolved", next, { stance });
  return sanitizeGroupJudgementForViewer(next, context.memberId);
}

async function upsertStance(context: Context, id: string, stance: JudgementStance, source: GroupJudgementStance["source"], evidence: Partial<GroupJudgementStance> = {}) {
  const judgement = await requireActiveJudgement(context, id);
  const client = createServiceSupabaseClient() as any;
  const updatedAt = new Date().toISOString();
  if (!client || !isUuid(context.familyId)) {
    const room = await readFallbackRoomRecord(judgement.roomRecordId);
    const eligibleIds = getFallbackEligibleMemberIds(room);
    if (!eligibleIds.includes(context.memberId)) throw new Error("访客和助手不能参与评评理。");
    const entry: GroupJudgementStance = { memberId: context.memberId, source, stance, updatedAt, ...evidence };
    await mutateFallback((items) => items.map((item) => item.id === id ? { ...item, stances: [...item.stances.filter((current) => current.memberId !== context.memberId), entry] } : item));
  } else {
    const { data: member } = await client.from("family_members").select("relationship_role,household_roles").eq("id", context.memberId).eq("family_id", context.familyId).maybeSingle();
    if (!member || !isEligibleJudgementMember({ householdRoles: member.household_roles, relationshipRole: member.relationship_role })) throw new Error("访客和助手不能参与评评理。");
    const { error } = await client.from("family_judgement_stances").upsert({
      confidence: evidence.confidence ?? null,
      evidence_message_id: evidence.evidenceMessageId || null,
      evidence_text: evidence.evidenceText || "",
      judgement_id: id,
      member_id: context.memberId,
      source,
      stance,
      updated_at: updatedAt
    }, { onConflict: "judgement_id,member_id" });
    if (error) throw error;
  }
  const next = await getGroupJudgement(context, id);
  if (!next) throw new Error("评评理不存在。");
  await trace(context, source === "ai_suggested" ? "group_judgement_stance_suggested" : "group_judgement_stance_confirmed", next, { source, stance });
  return next;
}

async function requireActiveJudgement(context: Context, id: string) {
  const judgement = await getGroupJudgement(context, id);
  if (!judgement) throw new Error("评评理不存在。");
  if (judgement.status !== "active" || (judgement.endsAt && new Date(judgement.endsAt) <= new Date())) throw new Error("评评理已经结束。");
  return judgement;
}

function normalizeCreateInput(input: CreateInput) {
  const statement = input.statement.trim().slice(0, 1200);
  const title = input.title.trim().slice(0, 80);
  const leftLabel = input.leftLabel.trim().slice(0, 30);
  const rightLabel = input.rightLabel.trim().slice(0, 30);
  if (!input.roomRecordId.trim()) throw new Error("缺少群聊 ID。");
  if (statement.length < 10) throw new Error("请先完整陈述事情经过。");
  if (!title || !leftLabel || !rightLabel) throw new Error("请确认争议问题和双方观点。");
  if (leftLabel === rightLabel) throw new Error("双方观点需要不同。");
  let endsAt: string | undefined;
  if (input.endsAt) {
    const end = new Date(input.endsAt);
    if (Number.isNaN(end.getTime()) || end <= new Date()) throw new Error("结束时间必须晚于当前时间。");
    endsAt = end.toISOString();
  }
  return { ...input, endsAt, leftLabel, rightLabel, roomRecordId: input.roomRecordId.trim(), statement, title };
}

function assertSideMembers(eligibleIds: string[], leftMemberId?: string, rightMemberId?: string) {
  for (const memberId of [leftMemberId, rightMemberId].filter(Boolean) as string[]) {
    if (!eligibleIds.includes(memberId)) throw new Error("代表成员必须是当前群聊中的真实家庭成员。");
  }
}

async function assertSupabaseRoomMember(client: any, context: Context, roomRecordId: string) {
  const { data: room, error } = await client.from("family_records").select("id,space_id,metadata,tags").eq("id", roomRecordId).eq("family_id", context.familyId).maybeSingle();
  if (error) throw error;
  const chatMembers = readChatMemberIds(room?.metadata);
  if (!room || !Array.isArray(room.tags) || !room.tags.some((tag: string) => tag === "群组" || tag === "群聊")) throw new Error("群聊不存在。");
  if (!chatMembers.includes(context.memberId)) throw new Error("你不是该群聊成员。");
  return room;
}

async function getSupabaseEligibleMemberIds(client: any, familyId: string, room: any) {
  const memberIds = readChatMemberIds(room.metadata);
  const { data, error } = await client.from("family_members").select("id,relationship_role,household_roles").eq("family_id", familyId).in("id", memberIds);
  if (error) throw error;
  return (data || []).filter((member: any) => isEligibleJudgementMember({ householdRoles: member.household_roles, relationshipRole: member.relationship_role })).map((member: any) => member.id);
}

function readChatMemberIds(metadata: unknown) {
  const value = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>).chatMembers : [];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

async function readSupabaseJudgement(client: any, row: any): Promise<GroupJudgement> {
  const { data, error } = await client.from("family_judgement_stances").select("*").eq("judgement_id", row.id).order("updated_at");
  if (error) throw error;
  return {
    closedAt: row.closed_at || undefined,
    closeReason: row.close_reason || undefined,
    createdAt: row.created_at,
    creatorMemberId: row.creator_member_id,
    endsAt: row.ends_at || undefined,
    familyId: row.family_id,
    id: row.id,
    leftLabel: row.left_label,
    leftMemberId: row.left_member_id || undefined,
    neutralSummary: row.neutral_summary || undefined,
    rightLabel: row.right_label,
    rightMemberId: row.right_member_id || undefined,
    roomRecordId: row.room_record_id,
    resolvedStance: row.resolved_stance || undefined,
    resolutionKind: row.resolution_kind || undefined,
    spaceId: row.space_id || undefined,
    statement: row.statement,
    stances: (data || []).map((item: any) => ({
      confidence: item.confidence ?? undefined,
      evidenceMessageId: item.evidence_message_id || undefined,
      evidenceText: item.evidence_text || undefined,
      memberId: item.member_id,
      source: item.source,
      stance: item.stance,
      updatedAt: item.updated_at
    })),
    status: row.status,
    title: row.title
  };
}

async function closeExpiredFallbackJudgements(roomRecordId: string) {
  const now = Date.now();
  await mutateFallback((items) => items.map((item) => {
    if (item.roomRecordId !== roomRecordId || item.status !== "active" || !item.endsAt || new Date(item.endsAt).getTime() > now) return item;
    const closed: GroupJudgement = { ...item, closeReason: "deadline", closedAt: new Date().toISOString(), status: "closed" };
    return { ...closed, neutralSummary: buildNeutralJudgementSummary(closed) };
  }));
}

async function closeExpiredSupabaseJudgements(client: any, familyId: string, roomRecordId: string) {
  const { data, error } = await client.from("family_judgements").select("*").eq("family_id", familyId).eq("room_record_id", roomRecordId).eq("status", "active").not("ends_at", "is", null).lte("ends_at", new Date().toISOString());
  if (error) throw error;
  for (const row of data || []) {
    const judgement = await readSupabaseJudgement(client, row);
    const closedAt = new Date().toISOString();
    const neutralSummary = buildNeutralJudgementSummary({ ...judgement, closeReason: "deadline", closedAt, status: "closed" });
    const { error: updateError } = await client.from("family_judgements").update({ close_reason: "deadline", closed_at: closedAt, neutral_summary: neutralSummary, status: "closed" }).eq("id", row.id).eq("status", "active");
    if (updateError) throw updateError;
  }
}

async function readFallback(): Promise<GroupJudgement[]> {
  try { return JSON.parse(await readFile(fallbackPath, "utf8")) as GroupJudgement[]; }
  catch { return []; }
}

async function mutateFallback(change: (items: GroupJudgement[]) => GroupJudgement[]) {
  const items = change(await readFallback());
  await mkdir("data", { recursive: true });
  await writeFile(fallbackPath, JSON.stringify(items, null, 2), "utf8");
}

async function readFallbackRoomRecord(roomRecordId: string): Promise<FamilyRecord | null> {
  const builtIn = familyRecords.find((record) => record.id === roomRecordId && Boolean(record.inviteLink)) || null;
  try {
    let match: FamilyRecord | null = null;
    for (const line of (await readFile(fallbackRecordsPath, "utf8")).split("\n").filter(Boolean)) {
      const parsed = JSON.parse(line) as { record?: FamilyRecord } & Partial<FamilyRecord>;
      const record = parsed.record || (parsed as FamilyRecord);
      if (record.id === roomRecordId) match = record;
    }
    return match || builtIn;
  } catch { return builtIn; }
}

function assertFallbackRoomMember(room: FamilyRecord | null, memberId: string): asserts room is FamilyRecord {
  if (!room?.inviteLink || !room.tags.some((tag) => tag === "群组" || tag === "群聊")) throw new Error("群聊不存在。");
  if (!room.chatMembers?.includes(memberId)) throw new Error("你不是该群聊成员。");
}

function getFallbackEligibleMemberIds(room: FamilyRecord | null) {
  const ids = new Set(room?.chatMembers || []);
  return familyMembers.filter((member) => ids.has(member.id) && isEligibleJudgementMember(member)).map((member) => member.id);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function trace(context: Context, eventType: string, judgement: GroupJudgement, metadata: Record<string, unknown>) {
  await createRawEvent({
    actorMemberId: context.memberId,
    familyId: context.familyId,
    rawPayload: { eventType, judgementId: judgement.id, roomRecordId: judgement.roomRecordId, ...metadata },
    sourceType: "meta_event"
  }).catch(() => undefined);
}
