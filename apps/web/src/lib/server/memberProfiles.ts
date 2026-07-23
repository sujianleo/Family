import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { validateMemberProfileJson } from "../aiSchema";
import { DEFAULT_ASSISTANT_NAME } from "../assistantIdentity";
import { familyMembers } from "../mockData";
import type { MemberProfile } from "../types";
import { withCalculatedMemberAge } from "../memberProfileAge";
import { invokeDeepSeekJson } from "./langchainAi";
import { readMemberOverrides } from "./memberOverrides";

type MemberProfileOptions = {
  backup?: boolean;
  dataDir?: string;
  force?: boolean;
  now?: Date;
  useAi?: boolean;
};

export type ProfileEvidenceCandidate = {
  eventId: string;
  memberId: string;
  field: "profile_source";
  value: string;
  sourceType: string;
  createdAt: string;
  confidence: number;
  status: "accepted" | "rejected";
  rejectionReason?: string;
};

type StoredMetaEvent = {
  id: string;
  type: string;
  actor_member_id: string | null;
  actor_name: string | null;
  record_id: string | null;
  space_id: string | null;
  text: string;
  metadata: unknown;
  created_at: string;
};

type StoredRawEvent = {
  id: string;
  actor_member_id: string | null;
  actor_member_key?: string | null;
  actor_name: string | null;
  conversation_id?: string | null;
  raw_payload_json?: unknown;
  raw_text: string | null;
  source_type: string;
  created_at?: string;
};

type ProfileCheckpoint = {
  processedEventIds: string[];
  updatedAt: string;
};

type StoredProfileItem = { memberId: string; memberName: string; source?: string; profile?: MemberProfile };
type StoredProfileDocument = { generated_at: string; profiles: StoredProfileItem[]; source_event_count: number };

const defaultDataDir = "data";
loadLocalEnv();
const deepseekTimeoutMs = Number(process.env.DEEPSEEK_PROFILE_TIMEOUT_MS || process.env.DEEPSEEK_TIMEOUT_MS || 12000);

export async function writeMemberProfiles({ backup = true, dataDir = defaultDataDir, force = false, now = new Date(), useAi = true }: MemberProfileOptions = {}) {
  const { candidates, events } = await readTrustedProfileEvents(dataDir);
  const checkpoint = await readProfileCheckpoint(dataDir);
  const processedIds = new Set(checkpoint.processedEventIds);
  const acceptedCandidates = candidates.filter((candidate) => candidate.status === "accepted");
  const newByMember = new Map<string, number>();
  for (const candidate of acceptedCandidates) {
    if (!processedIds.has(candidate.eventId)) {
      newByMember.set(candidate.memberId, (newByMember.get(candidate.memberId) || 0) + 1);
    }
  }
  const thresholdReached = [...newByMember.values()].some((count) => count >= 5);
  if (!force && !thresholdReached) {
    const current = await readStoredProfileDocument(dataDir);
    return {
      ...current,
      status: "skipped" as const,
      evidence_metrics: buildEvidenceMetrics(candidates, newByMember),
      reason: "trusted_event_threshold_not_reached"
    };
  }

  const profiles = [];
  for (const member of familyMembers) {
    profiles.push(await buildMemberProfile(member.id, member.displayName, events, now, useAi));
  }
  const result = {
    generated_at: now.toISOString(),
    source_event_count: events.length,
    profiles,
    status: "written" as const,
    evidence_metrics: buildEvidenceMetrics(candidates, newByMember)
  };

  await mkdir(dataDir, { recursive: true });
  const profilePath = `${dataDir}/member-profiles.json`;
  if (backup && existsSync(profilePath)) {
    const archiveDir = `${dataDir}/archive/profile-rebuild-${formatArchiveTimestamp(now)}`;
    await mkdir(archiveDir, { recursive: true });
    await copyFile(profilePath, `${archiveDir}/member-profiles.json`);
    for (const fileName of ["meta-summaries.jsonl", "summaries.jsonl", "profile-learning-checkpoint.json"]) {
      const sourcePath = `${dataDir}/${fileName}`;
      if (existsSync(sourcePath)) {
        await copyFile(sourcePath, `${archiveDir}/${fileName}`);
      }
    }
    await writeFile(
      `${archiveDir}/manifest.json`,
      `${JSON.stringify({ archivedAt: now.toISOString(), profilePath, trustedSourceEventCount: events.length }, null, 2)}\n`,
      "utf8"
    );
  }
  const temporaryPath = `${profilePath}.next`;
  await writeFile(temporaryPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  JSON.parse(await readFile(temporaryPath, "utf8"));
  await rename(temporaryPath, profilePath);
  await writeFile(
    `${dataDir}/profile-learning-checkpoint.json`,
    `${JSON.stringify({ processedEventIds: acceptedCandidates.map((candidate) => candidate.eventId), updatedAt: now.toISOString() }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(`${dataDir}/profile-evidence-candidates.jsonl.next`, `${candidates.map((candidate) => JSON.stringify(candidate)).join("\n")}\n`, "utf8");
  await rename(`${dataDir}/profile-evidence-candidates.jsonl.next`, `${dataDir}/profile-evidence-candidates.jsonl`);
  await writeProfileQualitySummary(dataDir, result.evidence_metrics, events.length);

  return result;
}

export async function readMemberProfileDescription(memberQuery: string, dataDir = defaultDataDir, now = new Date()) {
  const profiles = await readMemberProfiles(dataDir);
  const overrides = await readMemberOverrides(dataDir);
  const normalizedQuery = memberQuery.trim();
  const aliasQuery = resolveProfileQueryAlias(normalizedQuery);
  const match = profiles.find((item) => profileMatchesQuery(item, normalizedQuery, aliasQuery, overrides));

  if (!match) {
    return {
      status: "missing" as const,
      memberQuery,
      text: "没有找到这个成员的人物画像。"
    };
  }

  const publicProfile = sanitizePublicProfile(withCalculatedMemberAge(match.profile || {}, now) || {});
  const text = formatProfileDescription(match.memberName, publicProfile);
  return {
    status: "found" as const,
    memberId: match.memberId,
    memberName: match.memberName,
    source: match.source || "unknown",
    text,
    profile: publicProfile
  };
}

export async function listAvailableMemberProfiles(dataDir = defaultDataDir) {
  const profiles = await readMemberProfiles(dataDir);
  return profiles
    .filter((item) => Object.keys(item.profile || {}).length > 0)
    .map((item) => ({ memberId: item.memberId, memberName: item.memberName }));
}

function resolveProfileQueryAlias(query: string) {
  const aliases: Record<string, string[]> = {
    爸爸: ["老爸", "父亲", "爸"],
    闺女: ["女儿", "姑娘"],
    老妈: ["妈妈", "母亲", "妈", "老娘"],
    老婆: ["媳妇", "妻子", "太太", "爱人"],
    姐姐: ["姐"],
    儿子: ["男孩"],
    [DEFAULT_ASSISTANT_NAME]: ["饭米粒", "小范大人", "家庭助手", "助手"]
  };

  for (const [memberName, memberAliases] of Object.entries(aliases)) {
    if (memberAliases.some((alias) => query.includes(alias))) {
      return memberName;
    }
  }

  return query;
}

function profileMatchesQuery(
  profile: { memberId: string; memberName: string },
  normalizedQuery: string,
  aliasQuery: string,
  overrides: Awaited<ReturnType<typeof readMemberOverrides>>
) {
  if (!normalizedQuery && !aliasQuery) {
    return false;
  }
  if (profile.memberId === normalizedQuery || profile.memberId === aliasQuery) {
    return true;
  }

  const override = overrides.find((item) => item.memberId === profile.memberId);
  const defaultMember = familyMembers.find((member) => member.id === profile.memberId);
  const names = [profile.memberName, defaultMember?.displayName, override?.displayName, ...(override?.previousNames || [])]
    .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
    .map((name) => name.trim());
  const queries = [normalizedQuery, aliasQuery].filter((query) => query.length > 0);

  return names.some((name) => queries.some((query) => name.includes(query) || query.includes(name)));
}

async function buildMemberProfile(memberId: string, memberName: string, events: StoredMetaEvent[], now: Date, useAi: boolean) {
  const relatedEvents = events.filter((event) => event.actor_member_id === memberId);
  const aiProfile = useAi ? await requestAiMemberProfile(memberId, memberName, relatedEvents, now) : null;
  if (aiProfile) {
    return aiProfile;
  }

  return buildRuleMemberProfile(memberId, memberName, relatedEvents, now);
}

function buildRuleMemberProfile(memberId: string, memberName: string, relatedEvents: StoredMetaEvent[], now: Date) {
  const profile: MemberProfile = {
    evidence: [],
    updatedAt: now.toISOString()
  };

  for (const event of relatedEvents) {
    const text = compactText(event.text);
    collectOccupationEvidence(profile, text, event);
    collectResumeEvidence(profile, text, event);
    collectListEvidence(profile, "interests", text, event, /(喜欢|爱好|爱吃|想吃|想去|想看)([^，。,.!！?？]{1,18})/g);
    collectListEvidence(profile, "healthNotes", text, event, /(身体|不舒服|过敏|疼|痛|发烧|咳嗽|血压|血糖|睡眠)([^，。,.!！?？]{0,22})/g);
    collectListEvidence(profile, "chronicConditions", text, event, /(基础病|慢性病|高血压|糖尿病|哮喘|心脏病|鼻炎|胃病)([^，。,.!！?？]{0,18})/g);
    collectListEvidence(profile, "careNotes", text, event, /(注意|忌口|少吃|不能吃|需要照顾|提醒)([^，。,.!！?？]{1,24})/g);
    collectMedicalVisit(profile, text, event);
  }

  const evidenceCount = profile.evidence?.length || 0;
  if (evidenceCount === 0) {
    return {
      memberId,
      memberName,
      profile: {}
    };
  }

  profile.confidence = Math.min(0.9, 0.45 + evidenceCount * 0.06);

  return {
    memberId,
    memberName,
    source: "rules",
    profile
  };
}

async function requestAiMemberProfile(memberId: string, memberName: string, relatedEvents: StoredMetaEvent[], now: Date) {
  if (relatedEvents.length === 0) {
    return null;
  }

  const sourceEvents = relatedEvents
    .filter((event) => event.text.trim())
    .slice(-80)
    .map((event) => ({
      id: event.id,
      type: event.type,
      text: event.text,
      created_at: event.created_at
    }));

  try {
    const json = await invokeDeepSeekJson(
      [
        {
          role: "system",
          content: buildProfileSystemPrompt()
        },
        {
          role: "user",
          content: JSON.stringify({
            member_id: memberId,
            member_name: memberName,
            events: sourceEvents
          })
        }
      ],
      {
        maxTokens: 1100,
        responseFormat: { type: "json_object" },
        temperature: 0.1,
        timeoutMs: deepseekTimeoutMs
      }
    );

    if (!json) {
      return null;
    }

    const schemaResult = validateMemberProfileJson(json, new Set(sourceEvents.map((event) => event.id)));
    if (!schemaResult.ok) {
      return null;
    }

    const parsed = normalizeAiProfile(schemaResult.value, now);
    if (!parsed || Object.keys(parsed).length === 0) {
      return {
        memberId,
        memberName,
        source: "ai",
        profile: {}
      };
    }

    return {
      memberId,
      memberName,
      source: "ai",
      profile: parsed
    };
  } catch {
    return null;
  }
}

function buildProfileSystemPrompt() {
  return `你是家庭 App 的人物画像抽取器。只输出 JSON。
目标：只从 events 中提取 member 的画像。events 是事实来源，不要修改事实，不要编造。
必须严格符合以下 Schema：只允许这些字段，字段可以省略，不要输出额外字段。
{
  "gender": "string 可选",
  "ageRange": "string 可选",
  "occupation": "string 可选",
  "resumeNotes": ["string"],
  "interests": ["string"],
  "healthNotes": ["string"],
  "chronicConditions": ["string"],
  "careNotes": ["string"],
  "recentMedicalVisits": [{"hospital":"string 可选","department":"string 可选","checkup":"string 可选","time":"string 可选","note":"string"}],
  "evidence": [{"eventId":"必须来自输入 events.id","field":"字段名","text":"证据短句","confidence":0.0}],
  "confidence": 0.0
}
规则：
1. 没有明确证据的字段不要输出，尤其不要猜性别、年龄、职业、基础病。
2. 医疗、健康、基础病只在文本明确出现时提取；不要把普通任务当医疗信息。
3. 每条画像结论必须有 evidence，eventId 必须来自输入。
4. 如果证据不足，输出 {}。`;
}

function normalizeAiProfile(value: unknown, now: Date): MemberProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const data = value as Record<string, unknown>;
  const profile: MemberProfile = {};
  copyStringField(profile, data, "gender");
  copyStringField(profile, data, "ageRange");
  copyStringField(profile, data, "occupation");
  copyStringArrayField(profile, data, "resumeNotes");
  copyStringArrayField(profile, data, "interests");
  copyStringArrayField(profile, data, "healthNotes");
  copyStringArrayField(profile, data, "chronicConditions");
  copyStringArrayField(profile, data, "careNotes");

  if (Array.isArray(data.recentMedicalVisits)) {
    profile.recentMedicalVisits = data.recentMedicalVisits
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
      .map((item) => ({
        hospital: readOptionalString(item.hospital),
        department: readOptionalString(item.department),
        checkup: readOptionalString(item.checkup),
        time: readOptionalString(item.time),
        note: readOptionalString(item.note)
      }))
      .filter((item) => item.note || item.hospital || item.checkup);
  }

  if (Array.isArray(data.evidence)) {
    profile.evidence = data.evidence
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
      .map((item) => ({
        eventId: readOptionalString(item.eventId) || "",
        field: readOptionalString(item.field) || "",
        text: readOptionalString(item.text) || "",
        confidence: typeof item.confidence === "number" ? Math.max(0, Math.min(1, item.confidence)) : 0.5
      }))
      .filter((item) => item.eventId && item.field && item.text);
  }

  if (typeof data.confidence === "number") {
    profile.confidence = Math.max(0, Math.min(1, data.confidence));
  }
  profile.updatedAt = now.toISOString();
  return profile;
}

function collectListEvidence(
  profile: MemberProfile,
  field: "resumeNotes" | "interests" | "healthNotes" | "chronicConditions" | "careNotes",
  text: string,
  event: StoredMetaEvent,
  pattern: RegExp
) {
  for (const match of text.matchAll(pattern)) {
    const value = compactText(`${match[1]}${match[2] || ""}`);
    if (!value) continue;
    const current = new Set(profile[field] || []);
    current.add(value);
    profile[field] = [...current];
    profile.evidence?.push({
      eventId: event.id,
      field,
      text: value,
      confidence: 0.58
    });
  }
}

function collectOccupationEvidence(profile: MemberProfile, text: string, event: StoredMetaEvent) {
  const match = text.match(/(?:求职意向|应聘岗位|目标岗位|职业|职位|岗位)[:：\s]*([^，。,.!！?？；;\n]{2,32})/);
  const occupation = compactText(match?.[1] || "");
  if (!occupation) {
    return;
  }

  profile.occupation = occupation;
  profile.evidence?.push({
    eventId: event.id,
    field: "occupation",
    text: occupation,
    confidence: 0.72
  });
}

function collectResumeEvidence(profile: MemberProfile, text: string, event: StoredMetaEvent) {
  if (!/(简历|求职|应聘|技能|经历|项目|教育|学历|毕业|岗位|职位)/.test(text)) {
    return;
  }

  const notes = [
    ...extractLabelValues(text, ["技能", "专业技能", "核心技能"]),
    ...extractLabelValues(text, ["经历", "工作经历", "项目经历"]),
    ...extractLabelValues(text, ["教育", "教育经历", "学历"])
  ];
  const fallback = notes.length ? [] : [compactText(text).slice(0, 96)];
  const current = new Set(profile.resumeNotes || []);

  for (const note of [...notes, ...fallback]) {
    const cleanNote = compactText(note).slice(0, 120);
    if (!cleanNote) continue;
    current.add(cleanNote);
    profile.evidence?.push({
      eventId: event.id,
      field: "resumeNotes",
      text: cleanNote,
      confidence: 0.68
    });
  }

  if (current.size > 0) {
    profile.resumeNotes = [...current];
  }
}

function extractLabelValues(text: string, labels: string[]) {
  const values: string[] = [];
  for (const label of labels) {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(new RegExp(`${escapedLabel}[:：\\s]*([^。.!！?？\\n]{2,80})`));
    if (match?.[1]) {
      values.push(match[1]);
    }
  }
  return values;
}

function copyStringField(profile: MemberProfile, data: Record<string, unknown>, field: "gender" | "ageRange" | "occupation") {
  const value = readOptionalString(data[field]);
  if (value) {
    profile[field] = value;
  }
}

function copyStringArrayField(
  profile: MemberProfile,
  data: Record<string, unknown>,
  field: "resumeNotes" | "interests" | "healthNotes" | "chronicConditions" | "careNotes"
) {
  if (!Array.isArray(data[field])) {
    return;
  }
  const values = data[field].filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  if (values.length) {
    profile[field] = [...new Set(values)];
  }
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function collectMedicalVisit(profile: MemberProfile, text: string, event: StoredMetaEvent) {
  if (!/(医院|门诊|体检|检查|复查|化验|\bCT\b|B超|拍片|验血)/i.test(text)) {
    return;
  }

  const visit = {
    hospital: text.match(/([^，。,.!！?？]{1,16}医院)/)?.[1],
    checkup: text.match(/(体检|复查|检查|化验|\bCT\b|B超|拍片|验血)([^，。,.!！?？]{0,18})/i)?.[0],
    time: event.created_at,
    note: compactText(text).slice(0, 80)
  };
  profile.recentMedicalVisits = [...(profile.recentMedicalVisits || []), visit];
  profile.evidence?.push({
    eventId: event.id,
    field: "recentMedicalVisits",
    text: visit.note || "",
    confidence: 0.62
  });
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
  try {
    const content = await readFile(filePath, "utf8");
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function readTrustedProfileEvents(dataDir: string) {
  const rawEvents = await readJsonl<StoredRawEvent>(`${dataDir}/raw-events.jsonl`);
  const candidates: ProfileEvidenceCandidate[] = [];
  const events: StoredMetaEvent[] = [];
  const seenFingerprints = new Set<string>();

  for (const event of rawEvents) {
    const text = compactText(event.raw_text || "");
    const sourceType = event.source_type || "unknown";
    const actorMemberId = event.actor_member_key || event.actor_member_id || "";
    const targetMemberIds = resolveProfileTargetMemberIds(text, actorMemberId);
    const baseRejection = profileSourceRejectionReason(event, text, targetMemberIds);

    for (const memberId of targetMemberIds.length ? targetMemberIds : [actorMemberId || "unknown"]) {
      const fingerprint = `${memberId}:${normalizeEvidenceValue(text)}`;
      const duplicate = !baseRejection && seenFingerprints.has(fingerprint);
      const rejectionReason = baseRejection || (duplicate ? "near_duplicate" : undefined);
      const candidate: ProfileEvidenceCandidate = {
        eventId: event.id,
        memberId,
        field: "profile_source",
        value: text,
        sourceType,
        createdAt: event.created_at || new Date(0).toISOString(),
        confidence: rejectionReason ? 0 : isSensitiveProfileText(text) ? 0.78 : 0.68,
        status: rejectionReason ? "rejected" : "accepted",
        rejectionReason
      };
      candidates.push(candidate);
      if (candidate.status === "rejected") {
        continue;
      }
      seenFingerprints.add(fingerprint);
      events.push({
        id: event.id,
        type: sourceType,
        actor_member_id: memberId,
        actor_name: familyMembers.find((member) => member.id === memberId)?.displayName || event.actor_name || null,
        record_id: null,
        space_id: null,
        text,
        metadata: event.raw_payload_json || {},
        created_at: event.created_at || new Date(0).toISOString()
      });
    }
  }

  return { candidates, events };
}

function profileSourceRejectionReason(event: StoredRawEvent, text: string, targetMemberIds: string[]) {
  if (!text) return "empty_text";
  if (
    /(?:^|[-_])(?:seed|synthetic|smoke|fixture|test)(?:[-_]|$)/i.test(event.id) ||
    /(?:synthetic|smoke|fixture|test)/i.test(event.conversation_id || "") ||
    readBooleanFromObject(event.raw_payload_json, "synthetic")
  ) {
    return "synthetic_or_test_data";
  }
  if (event.conversation_id === "app-hourly-metadata-learning") return "background_learning";
  if (["assistant_output", "automation.action", "automation.action_request", "automation.pipeline_request"].includes(event.source_type)) return "generated_or_automation_output";
  if (!["profile.confirmed", "memory.confirmed", "resource.user_confirmed"].includes(event.source_type)) return "untrusted_source_type";
  if (!targetMemberIds.length) return "missing_member_attribution";
  if (/每小时 AI 自动学习|正在处理|处理完成|家庭助手回复/.test(text)) return "system_or_ui_text";
  return undefined;
}

function hasProfileFactCue(text: string) {
  return /(喜欢|不喜欢|爱好|爱吃|习惯|偏好|作息|研究|学习|工作|职业|岗位|简历|学校|班级|生日|地址|过敏|基础病|慢性病|医院|体检|检查|复查|血压|血糖|睡眠|不舒服|疼|痛|需要注意|忌口|少吃|不能吃|需要照顾)/.test(text);
}

function resolveProfileTargetMemberIds(text: string, actorMemberId: string) {
  const aliases: Record<string, string[]> = {
    dad: ["爸爸", "老爸", "父亲"], daughter: ["闺女", "女儿"], me: ["我", "本人", "小明"], mom: ["老妈", "妈妈", "母亲"],
    sister: ["姐姐", "老姐", "姐"], son: ["儿子"], wife: ["老婆", "媳妇", "妻子"]
  };
  const explicit = familyMembers
    .filter((member) => member.id !== "me")
    .filter((member) => text.includes(member.displayName) || (aliases[member.id] || []).some((alias) => text.includes(alias)))
    .map((member) => member.id);
  if (explicit.length) return [...new Set(explicit)];
  if (!/(我|本人|我自己)/.test(text)) return [];
  return familyMembers.some((member) => member.id === actorMemberId) ? [actorMemberId] : [];
}

function normalizeEvidenceValue(value: string) {
  return value.toLowerCase().replace(/[\s，。,.!！?？:：；;、"'“”‘’]/g, "").replace(/(家庭助手回复|根据本地数据)/g, "").slice(0, 160);
}

function isSensitiveProfileText(text: string) {
  return /(职业|岗位|简历|医院|体检|检查|复查|基础病|慢性病|血压|血糖|过敏|疼|痛)/.test(text);
}

function buildEvidenceMetrics(candidates: ProfileEvidenceCandidate[], newByMember: Map<string, number>) {
  return {
    accepted: candidates.filter((candidate) => candidate.status === "accepted").length,
    rejected: candidates.filter((candidate) => candidate.status === "rejected").length,
    duplicate_rejected: candidates.filter((candidate) => candidate.rejectionReason === "near_duplicate").length,
    new_by_member: Object.fromEntries(newByMember)
  };
}

async function readProfileCheckpoint(dataDir: string): Promise<ProfileCheckpoint> {
  try {
    return JSON.parse(await readFile(`${dataDir}/profile-learning-checkpoint.json`, "utf8")) as ProfileCheckpoint;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { processedEventIds: [], updatedAt: new Date(0).toISOString() };
    throw error;
  }
}

async function readStoredProfileDocument(dataDir: string): Promise<StoredProfileDocument> {
  try {
    const parsed = JSON.parse(await readFile(`${dataDir}/member-profiles.json`, "utf8")) as Partial<StoredProfileDocument>;
    return {
      generated_at: typeof parsed.generated_at === "string" ? parsed.generated_at : new Date(0).toISOString(),
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
      source_event_count: typeof parsed.source_event_count === "number" ? parsed.source_event_count : 0
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { generated_at: new Date(0).toISOString(), profiles: [], source_event_count: 0 };
    throw error;
  }
}

function formatArchiveTimestamp(now: Date) {
  return now.toISOString().replace(/[:.]/g, "-");
}

async function writeProfileQualitySummary(dataDir: string, evidenceMetrics: ReturnType<typeof buildEvidenceMetrics>, consumedEventCount: number) {
  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(await readFile(`${dataDir}/ai-quality-summary.json`, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  await writeFile(
    `${dataDir}/ai-quality-summary.json`,
    `${JSON.stringify({ ...current, generatedAt: new Date().toISOString(), profile: { ...evidenceMetrics, consumedEventCount } }, null, 2)}\n`,
    "utf8"
  );
}

async function readMemberProfiles(dataDir: string): Promise<Array<{ memberId: string; memberName: string; source?: string; profile?: MemberProfile }>> {
  try {
    const content = await readFile(`${dataDir}/member-profiles.json`, "utf8");
    const data = JSON.parse(content) as { profiles?: Array<{ memberId: string; memberName: string; source?: string; profile?: MemberProfile }> };
    return mergeDefaultMemberProfiles(data.profiles || [], dataDir);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return mergeDefaultMemberProfiles([], dataDir);
    }
    throw error;
  }
}

async function mergeDefaultMemberProfiles(profiles: Array<{ memberId: string; memberName: string; source?: string; profile?: MemberProfile }>, dataDir: string) {
  const overrides = await readMemberOverrides(dataDir);
  const knownIds = new Set(profiles.map((profile) => profile.memberId));
  const merged = [
    ...profiles,
    ...familyMembers
      .filter((member) => !knownIds.has(member.id))
      .map((member) => ({
        memberId: member.id,
        memberName: member.displayName,
        source: "mockData",
        profile: member.profile || {}
      }))
  ];
  return merged.map((profile) => {
    const override = overrides.find((item) => item.memberId === profile.memberId);
    const defaultMember = familyMembers.find((member) => member.id === profile.memberId);
    const withDefaultProfile = defaultMember?.profile
      ? {
          ...profile,
          profile: mergeProfileDefaults(defaultMember.profile, profile.profile || {})
        }
      : profile;
    return override
      ? {
          ...withDefaultProfile,
          memberName: override.displayName,
          profile: mergeProfileDefaults(withDefaultProfile.profile || {}, override.profile || {})
        }
      : withDefaultProfile;
  });
}

function mergeProfileDefaults(defaultProfile: MemberProfile, profile: MemberProfile) {
  return {
    ...defaultProfile,
    ...profile,
    careNotes: mergeStringArrays(defaultProfile.careNotes, profile.careNotes),
    chronicConditions: mergeStringArrays(defaultProfile.chronicConditions, profile.chronicConditions),
    healthNotes: mergeStringArrays(defaultProfile.healthNotes, profile.healthNotes),
    interests: mergeStringArrays(defaultProfile.interests, profile.interests),
    resumeNotes: mergeStringArrays(defaultProfile.resumeNotes, profile.resumeNotes)
  };
}

function mergeStringArrays(defaultValues?: string[], values?: string[]) {
  return [...new Set([...(defaultValues || []), ...(values || [])])];
}

function formatProfileDescription(memberName: string, profile: MemberProfile) {
  const lines: string[] = [`${memberName}目前的画像：`];
  const basic = [
    profile.gender ? `性别：${profile.gender}` : "",
    profile.age !== undefined ? `年龄：${profile.age} 岁` : profile.ageRange ? `年龄：${profile.ageRange}` : "",
    profile.birthDate ? `生日：${profile.birthCalendar === "lunar" ? "农历" : "公历"} ${formatStoredBirthDate(profile.birthDate)}` : "",
    profile.occupation ? `职业：${profile.occupation}` : ""
  ].filter(Boolean);

  appendSection(lines, "基础信息", basic);
  appendSection(lines, "简历资料", profile.resumeNotes);
  appendSection(lines, "生活偏好", profile.interests);
  appendSection(lines, "健康记录", profile.healthNotes);
  appendSection(lines, "基础病/长期状况", profile.chronicConditions);
  appendSection(lines, "需要注意", profile.careNotes);

  if (profile.recentMedicalVisits?.length) {
    appendSection(
      lines,
      "近期医院/检查",
      profile.recentMedicalVisits.map((visit) => [visit.time, visit.hospital, visit.department, visit.checkup, visit.note].filter(Boolean).join(" · "))
    );
  }

  if (lines.length === 1) {
    return `目前还没有足够的已确认信息来描述${memberName}。`;
  }

  lines.push("这些内容来自已确认的家庭记录，可以继续补充或修正。");
  return lines.join("\n\n");
}

function formatStoredBirthDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!month || !day) return value;
  return `${year ? `${year} 年 ` : ""}${month} 月 ${day} 日`;
}

function compactText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function appendSection(lines: string[], title: string, values?: string[]) {
  const cleanValues = (values || []).map(sanitizeProfileDisplayText).filter(Boolean);
  if (!cleanValues.length) return;
  lines.push(`${title}：${cleanValues.join("、")}。`);
}

function sanitizeProfileDisplayText(value: string) {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizePublicProfile(profile: MemberProfile): MemberProfile {
  const syntheticEvidence = (profile.evidence || []).filter((item) => isSyntheticEvidenceId(item.eventId));
  if (!syntheticEvidence.length) {
    return { ...profile, evidence: undefined, confidence: undefined };
  }
  const sanitized: MemberProfile = {
    ...profile,
    evidence: undefined,
    confidence: undefined
  };
  for (const evidence of syntheticEvidence) {
    const field = evidence.field as keyof MemberProfile;
    const current = sanitized[field];
    if (Array.isArray(current)) {
      (sanitized as Record<string, unknown>)[field] = current.filter((value) => {
        if (typeof value === "string") return compactText(value) !== compactText(evidence.text);
        if (value && typeof value === "object" && "note" in value) {
          return compactText(String(value.note || "")) !== compactText(evidence.text);
        }
        return true;
      });
    } else if (typeof current === "string" && compactText(current) === compactText(evidence.text)) {
      delete (sanitized as Record<string, unknown>)[field];
    }
  }
  return sanitized;
}

function isSyntheticEvidenceId(value: string) {
  return /(?:^|[-_])(?:seed|synthetic|smoke|fixture|test)(?:[-_]|$)/i.test(value);
}

function readBooleanFromObject(value: unknown, key: string) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>)[key] === true);
}

function loadLocalEnv() {
  const envPath = ".env.local";
  if (!existsSync(envPath)) {
    return;
  }

  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index <= 0) {
      continue;
    }
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}
