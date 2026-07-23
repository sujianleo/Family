import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServiceExternalStoreClient } from "./externalStoreServer";

export type KnowledgeInquiryStatus =
  | "awaiting_choice"
  | "awaiting_member_reply"
  | "awaiting_user_input"
  | "resolved"
  | "dismissed";

export type KnowledgeInquiryEvidence = {
  actorMemberId: string;
  actorName: string;
  confirmationStatus: "self_reported";
  createdAt: string;
  factType: string;
  id: string;
  sensitivity: "normal" | "sensitive";
  source: "member_reply" | "user_input";
  speakerMemberId: string;
  subjectMemberId: string;
  text: string;
  validFrom: string;
  validUntil: string | null;
};

export type KnowledgeInquiryLease = {
  expiresAt: string;
  owner: string;
  token: string;
};

export type KnowledgeInquiry = {
  createdAt: string;
  creationKey: string;
  evidence: KnowledgeInquiryEvidence[];
  familyId: string;
  id: string;
  lease: KnowledgeInquiryLease | null;
  processedTransitionKeys: string[];
  question: string;
  requesterMemberId: string;
  requesterName: string;
  retryCount: number;
  revision: number;
  status: KnowledgeInquiryStatus;
  targetMemberId: string;
  targetMemberName: string;
  updatedAt: string;
};

type StoreOptions = {
  dataDir?: string;
  familyId?: string;
  idempotencyKey?: string;
  now?: Date;
};

const fileName = "knowledge-inquiries.json";
const fileLocks = new Map<string, Promise<void>>();
const maxTransitionRetries = 4;

export async function createKnowledgeInquiry(input: {
  dataDir?: string;
  familyId: string;
  idempotencyKey?: string;
  now?: Date;
  question: string;
  requesterMemberId: string;
  requesterName: string;
  targetMemberId: string;
  targetMemberName: string;
}) {
  const now = (input.now || new Date()).toISOString();
  const explicitCreationKey = input.idempotencyKey?.trim() || "";
  const creationKey = explicitCreationKey || buildCreationKey(input);
  const existing = (await readKnowledgeInquiries(input.dataDir, input.familyId)).find(
    (item) => (Boolean(explicitCreationKey) && item.creationKey === creationKey) || (
      !isTerminal(item.status) &&
      item.requesterMemberId === input.requesterMemberId &&
      item.targetMemberId === input.targetMemberId &&
      normalizeQuestion(item.question) === normalizeQuestion(input.question)
    )
  );
  if (existing) return existing;

  const inquiry: KnowledgeInquiry = {
    createdAt: now,
    creationKey,
    evidence: [],
    familyId: input.familyId,
    id: randomUUID(),
    lease: null,
    processedTransitionKeys: [],
    question: input.question,
    requesterMemberId: input.requesterMemberId,
    requesterName: input.requesterName,
    retryCount: 0,
    revision: 1,
    status: "awaiting_choice",
    targetMemberId: input.targetMemberId,
    targetMemberName: input.targetMemberName,
    updatedAt: now
  };
  if (useDatabase(input.familyId)) {
    const databaseInquiry = await insertDatabaseInquiry(inquiry);
    if (databaseInquiry) return databaseInquiry;
  }
  return withFileLock(resolvePath(input.dataDir), async () => {
    const inquiries = await readFileInquiries(input.dataDir);
    const duplicate = inquiries.find((item) => (Boolean(explicitCreationKey) && item.creationKey === creationKey) || (
      !isTerminal(item.status) &&
      item.requesterMemberId === input.requesterMemberId &&
      item.targetMemberId === input.targetMemberId &&
      normalizeQuestion(item.question) === normalizeQuestion(input.question)
    ));
    if (duplicate) return duplicate;
    await writeFileInquiries([...inquiries, inquiry], input.dataDir);
    return inquiry;
  });
}

export async function chooseKnowledgeInquiryPath(
  inquiryId: string,
  status: Extract<KnowledgeInquiryStatus, "awaiting_member_reply" | "awaiting_user_input" | "dismissed">,
  options: StoreOptions = {}
) {
  return updateInquiry(inquiryId, options, (inquiry) => {
    if (inquiry.status !== "awaiting_choice" && !(inquiry.status === "dismissed" && status === "awaiting_member_reply")) {
      throw new Error("这个信息核实流程当前不能切换到该分支。");
    }
    return { ...inquiry, status };
  });
}

export async function provideKnowledgeInquiryInput(input: {
  actorMemberId: string;
  actorName: string;
  dataDir?: string;
  familyId?: string;
  idempotencyKey?: string;
  inquiryId: string;
  now?: Date;
  text: string;
}) {
  return updateInquiry(input.inquiryId, input, (inquiry, timestamp) => {
    if (inquiry.status !== "awaiting_user_input") throw new Error("这个信息核实流程当前不等待用户补充。");
    if (inquiry.requesterMemberId && input.actorMemberId !== inquiry.requesterMemberId) throw new Error("只有发起人可以补充本轮信息。");
    const evidence = buildEvidence("user_input", inquiry, input.actorMemberId, input.actorName, input.text, timestamp);
    return { ...inquiry, evidence: [...inquiry.evidence, evidence], status: "resolved" };
  });
}

export async function collectKnowledgeInquiryReply(input: {
  actorMemberId: string;
  actorName: string;
  dataDir?: string;
  familyId?: string;
  idempotencyKey?: string;
  inquiryId: string;
  now?: Date;
  text: string;
}) {
  return updateInquiry(input.inquiryId, input, (inquiry, timestamp) => {
    if (inquiry.status !== "awaiting_member_reply") throw new Error("这个信息核实流程当前不等待家人回复。");
    if (input.actorMemberId !== inquiry.targetMemberId) throw new Error("只有被询问的家人本人回复才能直接成为可靠依据。");
    const evidence = buildEvidence("member_reply", inquiry, input.actorMemberId, input.actorName, input.text, timestamp);
    return { ...inquiry, evidence: [...inquiry.evidence, evidence], lease: null, status: "resolved" };
  });
}

export async function retryKnowledgeInquiry(inquiryId: string, options: StoreOptions & { leaseOwner?: string } = {}) {
  const owner = options.leaseOwner || `knowledge-followup:${process.pid}`;
  const claimed = await claimKnowledgeInquiryLease(inquiryId, owner, { ...options, ttlMs: 30_000 });
  try {
    return await updateInquiry(inquiryId, options, (inquiry) => {
      if (inquiry.status !== "awaiting_member_reply") throw new Error("只有等待本人回复的信息核实流程可以重问。");
      if (inquiry.retryCount >= 2) throw new Error("同一问题最多温和重问两次，避免给家人造成压力。");
      if (inquiry.lease?.token !== claimed.token) throw new Error("信息核实流程的执行租约已经变化，请稍后重试。");
      return { ...inquiry, lease: null, retryCount: inquiry.retryCount + 1 };
    });
  } catch (error) {
    await releaseKnowledgeInquiryLease(inquiryId, claimed.token, options).catch(() => undefined);
    throw error;
  }
}

export async function claimKnowledgeInquiryLease(
  inquiryId: string,
  owner: string,
  options: StoreOptions & { ttlMs?: number } = {}
) {
  const token = randomUUID();
  const now = options.now || new Date();
  const expiresAt = new Date(now.getTime() + Math.max(1_000, options.ttlMs || 30_000)).toISOString();
  const inquiry = await updateInquiry(inquiryId, { ...options, idempotencyKey: undefined }, (current) => {
    const activeLease = current.lease && new Date(current.lease.expiresAt).getTime() > now.getTime();
    if (activeLease && current.lease?.owner !== owner) throw new Error("这个信息核实流程正在由另一个执行器处理。");
    return { ...current, lease: { expiresAt, owner, token } };
  });
  return { inquiry, token };
}

export async function releaseKnowledgeInquiryLease(inquiryId: string, token: string, options: StoreOptions = {}) {
  return updateInquiry(inquiryId, { ...options, idempotencyKey: undefined }, (inquiry) => {
    if (!inquiry.lease) return inquiry;
    if (inquiry.lease.token !== token) throw new Error("不能释放其他执行器持有的租约。");
    return { ...inquiry, lease: null };
  });
}

export async function getKnowledgeInquiry(inquiryId: string, dataDir?: string, familyId?: string) {
  return (await readKnowledgeInquiries(dataDir, familyId)).find((item) => item.id === inquiryId) || null;
}

export async function readKnowledgeInquiries(dataDir?: string, familyId?: string): Promise<KnowledgeInquiry[]> {
  if (familyId && useDatabase(familyId)) {
    const databaseRows = await readDatabaseInquiries(familyId);
    if (databaseRows) return databaseRows;
  }
  const rows = await readFileInquiries(dataDir);
  return familyId ? rows.filter((item) => item.familyId === familyId) : rows;
}

function buildEvidence(
  source: KnowledgeInquiryEvidence["source"],
  inquiry: KnowledgeInquiry,
  actorMemberId: string,
  actorName: string,
  text: string,
  createdAt: string
): KnowledgeInquiryEvidence {
  const normalized = text.trim();
  if (!normalized) throw new Error("补充内容不能为空。");
  const factType = inferFactType(inquiry.question);
  const sensitive = ["contact", "health", "location", "medication", "schedule"].includes(factType);
  return {
    actorMemberId,
    actorName,
    confirmationStatus: "self_reported",
    createdAt,
    factType,
    id: `inquiry-evidence-${randomUUID()}`,
    sensitivity: sensitive ? "sensitive" : "normal",
    source,
    speakerMemberId: actorMemberId,
    subjectMemberId: inquiry.targetMemberId,
    text: normalized,
    validFrom: createdAt,
    validUntil: sensitive ? new Date(new Date(createdAt).getTime() + 180 * 86_400_000).toISOString() : null
  };
}

async function updateInquiry(
  inquiryId: string,
  options: StoreOptions,
  transform: (inquiry: KnowledgeInquiry, timestamp: string) => KnowledgeInquiry
) {
  if (options.familyId && useDatabase(options.familyId)) {
    let databaseRecordFound = false;
    for (let attempt = 0; attempt < maxTransitionRetries; attempt += 1) {
      const current = await getDatabaseInquiry(inquiryId, options.familyId);
      if (!current) break;
      databaseRecordFound = true;
      const duplicate = duplicateTransition(current, options.idempotencyKey);
      if (duplicate) return current;
      const next = buildUpdatedInquiry(current, options, transform);
      const saved = await compareAndSwapDatabaseInquiry(current, next);
      if (saved) return saved;
    }
    if (databaseRecordFound) throw new Error("信息核实流程被并发更新，请重试。");
  }
  return withFileLock(resolvePath(options.dataDir), async () => {
    const inquiries = await readFileInquiries(options.dataDir);
    const index = inquiries.findIndex((item) => item.id === inquiryId);
    if (index < 0) throw new Error("没有找到这个信息核实流程。");
    if (duplicateTransition(inquiries[index], options.idempotencyKey)) return inquiries[index];
    const updated = buildUpdatedInquiry(inquiries[index], options, transform);
    inquiries[index] = updated;
    await writeFileInquiries(inquiries, options.dataDir);
    return updated;
  });
}

function buildUpdatedInquiry(
  inquiry: KnowledgeInquiry,
  options: StoreOptions,
  transform: (inquiry: KnowledgeInquiry, timestamp: string) => KnowledgeInquiry
) {
  const timestamp = (options.now || new Date()).toISOString();
  const transitionKeys = options.idempotencyKey?.trim()
    ? [...new Set([...inquiry.processedTransitionKeys, options.idempotencyKey.trim()])].slice(-50)
    : inquiry.processedTransitionKeys;
  return {
    ...transform(inquiry, timestamp),
    processedTransitionKeys: transitionKeys,
    revision: inquiry.revision + 1,
    updatedAt: timestamp
  };
}

function duplicateTransition(inquiry: KnowledgeInquiry, idempotencyKey?: string) {
  const key = idempotencyKey?.trim();
  return Boolean(key && inquiry.processedTransitionKeys.includes(key));
}

function resolvePath(dataDir?: string) {
  return path.join(dataDir || path.resolve(process.cwd(), "data"), fileName);
}

async function readFileInquiries(dataDir?: string): Promise<KnowledgeInquiry[]> {
  try {
    const parsed = JSON.parse(await readFile(resolvePath(dataDir), "utf8"));
    return Array.isArray(parsed) ? parsed.map(normalizeInquiry) : [];
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeFileInquiries(inquiries: KnowledgeInquiry[], dataDir?: string) {
  const filePath = resolvePath(dataDir);
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(inquiries, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

async function withFileLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const previous = fileLocks.get(filePath) || Promise.resolve();
  let release: () => void = () => {};
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  fileLocks.set(filePath, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (fileLocks.get(filePath) === tail) fileLocks.delete(filePath);
  }
}

function normalizeInquiry(value: Partial<KnowledgeInquiry>): KnowledgeInquiry {
  return {
    createdAt: value.createdAt || new Date(0).toISOString(),
    creationKey: value.creationKey || `legacy:${value.id || randomUUID()}`,
    evidence: Array.isArray(value.evidence) ? value.evidence : [],
    familyId: value.familyId || "local-family",
    id: value.id || randomUUID(),
    lease: value.lease || null,
    processedTransitionKeys: Array.isArray(value.processedTransitionKeys) ? value.processedTransitionKeys : [],
    question: value.question || "",
    requesterMemberId: value.requesterMemberId || "",
    requesterName: value.requesterName || "",
    retryCount: Number(value.retryCount || 0),
    revision: Math.max(1, Number(value.revision || 1)),
    status: value.status || "awaiting_choice",
    targetMemberId: value.targetMemberId || "",
    targetMemberName: value.targetMemberName || "",
    updatedAt: value.updatedAt || value.createdAt || new Date(0).toISOString()
  };
}

function buildCreationKey(input: { familyId: string; question: string; requesterMemberId: string; targetMemberId: string }) {
  return [input.familyId, input.requesterMemberId, input.targetMemberId, normalizeQuestion(input.question)].join(":");
}

function normalizeQuestion(question: string) {
  return question.trim().replace(/[。.!！?？\s]+/g, "").toLowerCase();
}

function isTerminal(status: KnowledgeInquiryStatus) {
  return status === "resolved" || status === "dismissed";
}

function inferFactType(question: string) {
  if (/电话|手机号|联系方式/.test(question)) return "contact";
  if (/药|服药|用药/.test(question)) return "medication";
  if (/血压|血糖|体温|心率|身体|心情|过敏/.test(question)) return "health";
  if (/哪里|在哪|放哪|位置|地址/.test(question)) return "location";
  if (/几点|什么时候|哪天|周几|回来|出门/.test(question)) return "schedule";
  if (/生日|纪念日/.test(question)) return "birthday";
  if (/吃|忌口|喜欢/.test(question)) return "food";
  return "family_fact";
}

function useDatabase(familyId: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(familyId) && Boolean(createServiceExternalStoreClient());
}

async function readDatabaseInquiries(familyId: string): Promise<KnowledgeInquiry[] | null> {
  const client = createServiceExternalStoreClient();
  if (!client) return null;
  const { data, error } = await client.from("knowledge_inquiries").select("payload").eq("family_id", familyId).order("updated_at", { ascending: false }).limit(200);
  if (error) return null;
  return (data || []).map((row: any) => normalizeInquiry((row as { payload?: Partial<KnowledgeInquiry> }).payload || {}));
}

async function getDatabaseInquiry(inquiryId: string, familyId: string): Promise<KnowledgeInquiry | null> {
  const client = createServiceExternalStoreClient();
  if (!client) return null;
  const { data, error } = await client.from("knowledge_inquiries").select("payload").eq("id", inquiryId).eq("family_id", familyId).maybeSingle();
  if (error || !data) return null;
  return normalizeInquiry((data as { payload?: Partial<KnowledgeInquiry> }).payload || {});
}

async function insertDatabaseInquiry(inquiry: KnowledgeInquiry): Promise<KnowledgeInquiry | null> {
  const client = createServiceExternalStoreClient();
  if (!client) return null;
  const row = databaseRow(inquiry);
  const { data, error } = await client.from("knowledge_inquiries").upsert(row, { onConflict: "family_id,active_key", ignoreDuplicates: true }).select("payload").maybeSingle();
  if (!error && data) return normalizeInquiry((data as { payload?: Partial<KnowledgeInquiry> }).payload || {});
  const { data: existing } = await client.from("knowledge_inquiries").select("payload").eq("family_id", inquiry.familyId).eq("active_key", inquiry.creationKey).maybeSingle();
  return existing ? normalizeInquiry((existing as { payload?: Partial<KnowledgeInquiry> }).payload || {}) : null;
}

async function compareAndSwapDatabaseInquiry(current: KnowledgeInquiry, next: KnowledgeInquiry): Promise<KnowledgeInquiry | null> {
  const client = createServiceExternalStoreClient();
  if (!client) return null;
  const { data, error } = await client
    .from("knowledge_inquiries")
    .update(databaseRow(next))
    .eq("id", current.id)
    .eq("family_id", current.familyId)
    .eq("revision", current.revision)
    .select("payload")
    .maybeSingle();
  if (error || !data) return null;
  return normalizeInquiry((data as { payload?: Partial<KnowledgeInquiry> }).payload || {});
}

function databaseRow(inquiry: KnowledgeInquiry) {
  return {
    active_key: isTerminal(inquiry.status) ? null : inquiry.creationKey,
    creation_key: inquiry.creationKey,
    family_id: inquiry.familyId,
    id: inquiry.id,
    lease_expires_at: inquiry.lease?.expiresAt || null,
    lease_owner: inquiry.lease?.owner || null,
    payload: inquiry,
    requester_member_id: inquiry.requesterMemberId,
    revision: inquiry.revision,
    status: inquiry.status,
    target_member_id: inquiry.targetMemberId,
    updated_at: inquiry.updatedAt
  };
}
