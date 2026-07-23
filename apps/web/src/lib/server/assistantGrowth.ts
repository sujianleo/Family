import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { TrustedAssistantContext } from "./trustedAssistantContext";

export type AssistantGrowthProfile = {
  experienceCount: number;
  familyId: string;
  learnedTraits: string[];
  processedEvidenceIds: string[];
  scores: {
    familiarity: number;
    initiative: number;
    steadiness: number;
    warmth: number;
  };
  stage: "newcomer" | "familiar" | "integrated" | "companion";
  stageLabel: string;
  updatedAt: string;
};

export type AssistantGrowthEvidence = {
  id: string;
  text: string;
};

type GrowthFile = { families?: AssistantGrowthProfile[] };
type GrowthGlobal = typeof globalThis & { familyAssistantGrowthQueue?: Promise<void> };

const growthFileName = "assistant-growth.json";
const globalForGrowth = globalThis as GrowthGlobal;

export async function evolveAssistantGrowth(input: {
  context: TrustedAssistantContext;
  dataDir: string;
  familyId: string;
  now?: Date;
}) {
  return withGrowthWriteLock(async () => {
    const file = await readGrowthFile(input.dataDir);
    const previous = file.families?.find((item) => item.familyId === input.familyId) || createInitialGrowth(input.familyId, input.now);
    const next = applyAssistantGrowthEvidence(previous, collectGrowthEvidence(input.context), input.now);
    if (next.updatedAt !== previous.updatedAt || !(file.families || []).some((item) => item.familyId === input.familyId)) {
      await mkdir(input.dataDir, { recursive: true });
      await writeFile(
        `${input.dataDir}/${growthFileName}`,
        `${JSON.stringify({ families: [...(file.families || []).filter((item) => item.familyId !== input.familyId), next] }, null, 2)}\n`,
        "utf8"
      );
    }
    return next;
  });
}

export function applyAssistantGrowthEvidence(
  previous: AssistantGrowthProfile,
  evidence: AssistantGrowthEvidence[],
  now = new Date()
): AssistantGrowthProfile {
  const processed = new Set(previous.processedEvidenceIds);
  const fresh = evidence.filter((item) => item.id && item.text.trim() && !processed.has(item.id) && !isTestEvidence(item));
  if (!fresh.length) return previous;

  const scores = { ...previous.scores };
  for (const item of fresh) {
    const text = item.text.replace(/\s+/g, "");
    scores.familiarity += 2;
    if (/(累|难过|紧张|焦虑|害怕|生病|不舒服|体检|复查|辛苦|压力|想哭)/.test(text)) {
      scores.warmth += 2;
      scores.steadiness += 2;
    }
    if (/(谢谢|感谢|陪着|关心|安慰|喜欢|开心|一家人)/.test(text)) scores.warmth += 2;
    if (/(任务|提醒|安排|协调|接送|采购|缴费|复习|计划|负责|完成)/.test(text)) scores.initiative += 2;
    if (/(冲突|争执|误会|慢慢说|别着急|冷静|确认)/.test(text)) scores.steadiness += 2;
  }

  const experienceCount = previous.experienceCount + fresh.length;
  const normalizedScores = {
    familiarity: clamp(scores.familiarity),
    initiative: clamp(scores.initiative),
    steadiness: clamp(scores.steadiness),
    warmth: clamp(scores.warmth)
  };
  const stage = growthStage(experienceCount);
  return {
    ...previous,
    experienceCount,
    learnedTraits: learnedTraits(normalizedScores),
    processedEvidenceIds: [...previous.processedEvidenceIds, ...fresh.map((item) => item.id)].slice(-800),
    scores: normalizedScores,
    stage,
    stageLabel: growthStageLabel(stage),
    updatedAt: now.toISOString()
  };
}

export function createInitialGrowth(familyId: string, now = new Date()): AssistantGrowthProfile {
  return {
    experienceCount: 0,
    familyId,
    learnedTraits: ["保持好奇", "先听清楚再行动"],
    processedEvidenceIds: [],
    scores: { familiarity: 10, initiative: 45, steadiness: 52, warmth: 55 },
    stage: "newcomer",
    stageLabel: "刚加入这个家",
    updatedAt: now.toISOString()
  };
}

export function assistantGrowthPrompt(profile?: AssistantGrowthProfile) {
  if (!profile) return "";
  return `成长阶段：${profile.stageLabel}。从可信家庭经历中逐渐形成的表达倾向：${profile.learnedTraits.join("、")}。这些倾向只能影响语气和组织方式，不能替代事实依据，也不能声称经历过未出现在可信上下文中的事情。`;
}

function collectGrowthEvidence(context: TrustedAssistantContext): AssistantGrowthEvidence[] {
  const rows = [
    ...context.familyLife.timeline.map((item) => ({ id: item.sourceId, text: item.text })),
    ...(context.latestOrganization?.timeline || []).map((item) => ({ id: item.sourceId, text: item.text })),
    ...context.familyLife.recentDays.map((item) => ({ id: item.id, text: item.summaryText })),
    ...context.confirmedMemories.map((item) => ({ id: item.eventId, text: item.text }))
  ];
  const seen = new Set<string>();
  return rows.filter((item) => {
    if (!item.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

async function readGrowthFile(dataDir: string): Promise<GrowthFile> {
  try {
    const parsed = JSON.parse(await readFile(`${dataDir}/${growthFileName}`, "utf8")) as GrowthFile;
    return { families: Array.isArray(parsed.families) ? parsed.families : [] };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { families: [] };
    throw error;
  }
}

async function withGrowthWriteLock<T>(operation: () => Promise<T>) {
  const previous = globalForGrowth.familyAssistantGrowthQueue || Promise.resolve();
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => { release = resolve; });
  globalForGrowth.familyAssistantGrowthQueue = previous.catch(() => undefined).then(() => current);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
  }
}

function growthStage(experienceCount: number): AssistantGrowthProfile["stage"] {
  if (experienceCount >= 40) return "companion";
  if (experienceCount >= 15) return "integrated";
  if (experienceCount >= 5) return "familiar";
  return "newcomer";
}

function growthStageLabel(stage: AssistantGrowthProfile["stage"]) {
  if (stage === "companion") return "稳定陪伴这个家";
  if (stage === "integrated") return "融入家庭日常";
  if (stage === "familiar") return "开始熟悉这个家";
  return "刚加入这个家";
}

function learnedTraits(scores: AssistantGrowthProfile["scores"]) {
  const traits = [scores.warmth >= 61 ? "表达更体贴" : "保持友善", scores.steadiness >= 61 ? "遇事更沉稳" : "先确认再判断"];
  if (scores.initiative >= 55) traits.push("更主动梳理下一步");
  if (scores.familiarity >= 30) traits.push("更熟悉家庭节奏");
  return traits;
}

function isTestEvidence(item: AssistantGrowthEvidence) {
  return /(?:^|[-_])(?:synthetic|seed|fixture|test|smoke)(?:[-_]|$)/i.test(item.id) || /虚构测试|仅供功能测试|人工合成/.test(item.text);
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}
