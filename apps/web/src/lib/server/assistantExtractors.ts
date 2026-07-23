import { getAiPrompt } from "../aiPrompts";
import { DEFAULT_ASSISTANT_NAME } from "../assistantIdentity";
import { parseTemporalExpression } from "../temporal";
import { knowledgeCandidateSchema } from "./ai/schemas/memory.schema";

export type KnowledgeMemoryType = "preference" | "habit" | "family_fact" | "health" | "location" | "note";

export type KnowledgeCandidate = {
  evidenceText: string;
  fact: string;
  memoryType: KnowledgeMemoryType;
  requiresConfirmation: true;
  subject: string;
  tags: string[];
};

export type KnowledgeExtractorInput = {
  subject?: string | null;
  text?: string | null;
};

export type ExtractorInvokeModel = (input: { prompt: string; userInput: string }) => Promise<unknown>;

export type KnowledgeExtractorOptions = {
  invokeModel?: ExtractorInvokeModel;
  now?: Date;
  timeZone?: string;
  useAi?: boolean;
};

const knowledgeMemoryTypes: KnowledgeMemoryType[] = ["preference", "habit", "family_fact", "health", "location", "note"];

export async function extractKnowledgeCandidate(input: KnowledgeExtractorInput, options: KnowledgeExtractorOptions = {}): Promise<KnowledgeCandidate> {
  const text = normalizeWhitespace(input.text || "");
  const fallback = buildLocalKnowledgeCandidate(text, input.subject);

  if (!options.invokeModel && !options.useAi) {
    return canonicalizeKnowledgeCandidate(fallback, text, options.now || new Date(), options.timeZone || "Asia/Shanghai");
  }

  const prompt = buildKnowledgeExtractPrompt(text, input.subject);
  try {
    const rawOutput = options.invokeModel ? await options.invokeModel({ prompt, userInput: text }) : null;
    return canonicalizeKnowledgeCandidate(
      normalizeKnowledgeCandidate(rawOutput, fallback),
      text,
      options.now || new Date(),
      options.timeZone || "Asia/Shanghai"
    );
  } catch {
    return canonicalizeKnowledgeCandidate(fallback, text, options.now || new Date(), options.timeZone || "Asia/Shanghai");
  }
}

function buildKnowledgeExtractPrompt(text: string, subject?: string | null) {
  const prompt = getAiPrompt("knowledge-extract-v1");
  return [
    `${prompt.id}`,
    prompt.body,
    "",
    "输入：",
    JSON.stringify(
      {
        subject: subject || "",
        text
      },
      null,
      2
    )
  ].join("\n");
}

function normalizeKnowledgeCandidate(rawOutput: unknown, fallback: KnowledgeCandidate): KnowledgeCandidate {
  const parsed = knowledgeCandidateSchema.safeParse(parseExtractorOutput(rawOutput));
  if (!parsed.success) {
    return fallback;
  }
  const payload = parsed.data;

  const subject = readString(payload.subject) || fallback.subject;
  const fact = cleanupFact(readString(payload.fact) || fallback.fact, subject) || fallback.fact;
  const memoryType = readKnowledgeMemoryType(payload.memoryType) || fallback.memoryType;
  const tags = normalizeTags(payload.tags, fallback.tags);
  const evidenceText = readString(payload.evidenceText) || fallback.evidenceText;

  return {
    evidenceText,
    fact,
    memoryType,
    requiresConfirmation: true,
    subject,
    tags
  };
}

function parseExtractorOutput(rawOutput: unknown): Record<string, unknown> | null {
  if (!rawOutput) {
    return null;
  }
  if (typeof rawOutput === "string") {
    try {
      const parsed = JSON.parse(rawOutput);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return typeof rawOutput === "object" && !Array.isArray(rawOutput) ? (rawOutput as Record<string, unknown>) : null;
}

function buildLocalKnowledgeCandidate(text: string, explicitSubject?: string | null): KnowledgeCandidate {
  const subject = normalizeSubject(explicitSubject) || inferSubject(text);
  const fact = cleanupFact(text, subject) || text;
  const memoryType = inferKnowledgeMemoryType(fact);
  return {
    evidenceText: text,
    fact,
    memoryType,
    requiresConfirmation: true,
    subject,
    tags: inferKnowledgeTags(fact, memoryType)
  };
}

function canonicalizeKnowledgeCandidate(
  candidate: KnowledgeCandidate,
  sourceText: string,
  now: Date,
  timeZone: string
) {
  if (!/(生日|纪念日)/.test(sourceText) || !/(今天|明天|后天)/.test(sourceText)) return candidate;
  const occurredOn = parseTemporalExpression(sourceText, now, timeZone, "record").occurredOn;
  if (!occurredOn) return candidate;
  const [, month, day] = occurredOn.split("-").map(Number);
  const occasion = sourceText.includes("纪念日") ? "纪念日" : "生日";
  return {
    ...candidate,
    fact: `${occasion}是${month}月${day}日`,
    memoryType: "family_fact" as const,
    tags: [...new Set([...candidate.tags, occasion])]
  };
}

function normalizeSubject(subject?: string | null) {
  const value = normalizeWhitespace(subject || "");
  if (!value) {
    return "";
  }
  if (/^(爸爸|老爸|爸|父亲)$/.test(value)) {
    return "爸爸";
  }
  if (/^(妈妈|老妈|妈|母亲)$/.test(value)) {
    return "妈妈";
  }
  return value;
}

function inferSubject(text: string) {
  const subjectPatterns: Array<[RegExp, string]> = [
    [/(爸爸|老爸|父亲|爸)/, "爸爸"],
    [/(妈妈|老妈|母亲|妈)/, "妈妈"],
    [/(老婆|媳妇)/, "老婆"],
    [/(姐姐|老姐|姐)/, "姐姐"],
    [/(闺女|女儿)/, "闺女"],
    [/(儿子)/, "儿子"],
    [/(小饭大人|小范大人|豆包|饭米粒|fanmili)/i, DEFAULT_ASSISTANT_NAME]
  ];
  const matchedSubject = subjectPatterns.find(([pattern]) => pattern.test(text))?.[1];
  if (matchedSubject) {
    return matchedSubject;
  }
  if (/(^|[，,。.!！?？；;：:\s])(我|我的|本人)(?=$|[有在把放存留的，,。.!！?？；;：:\s])/.test(text)) {
    return "我";
  }
  return "家庭";
}

function cleanupFact(text: string, subject: string) {
  let fact = normalizeWhitespace(text)
    .replace(/^(请)?(帮我)?(记一下|记下来|记住|保存一下|保存|记录一下|记录|备注一下|备注)[，,。.!！?？；;：:\s]*/g, "")
    .replace(/[，,。.!！?？；;：:]+$/g, "")
    .replace(/(请)?(帮我)?(记一下|记下来|记住|保存一下|保存|记录一下|记录|备注一下|备注)$/g, "")
    .replace(/[，,。.!！?？；;：:]+$/g, "")
    .trim();

  if (subject) {
    fact = fact.replace(new RegExp(`^${escapeRegExp(subject)}[，,：: ]*`), "").trim();
    if (subject === "爸爸") {
      fact = fact.replace(/^(老爸|父亲|爸)[，,：: ]*/, "").trim();
    }
    if (subject === "妈妈") {
      fact = fact.replace(/^(老妈|母亲|妈)[，,：: ]*/, "").trim();
    }
    if (subject === "姐姐") {
      fact = fact.replace(/^(老姐|姐)[，,：: ]*/, "").trim();
    }
    if (subject === "我") {
      fact = fact.replace(/^(我|本人)[，,：: ]*/, "").trim();
    }
  }

  return fact;
}

function inferKnowledgeMemoryType(text: string): KnowledgeMemoryType {
  if (/(喜欢|不喜欢|爱吃|偏好|爱喝|讨厌|想吃|想喝)/.test(text)) {
    return "preference";
  }
  if (/(血压|血糖|基础病|睡眠|失眠|过敏|医院|检查|用药|药|疼|痛)/.test(text)) {
    return "health";
  }
  if (/(习惯|作息|每天|经常|总是|早上|晚上|午休)/.test(text)) {
    return "habit";
  }
  if (/(住在|放在|落在|留在|存在|东西在|物品在|地址|小区|公司|学校|医院|海淀|朝阳|北京|别人家)/.test(text)) {
    return "location";
  }
  return text ? "family_fact" : "note";
}

function inferKnowledgeTags(text: string, memoryType: KnowledgeMemoryType) {
  const tags = new Set<string>(["家庭"]);
  if (memoryType === "preference") {
    tags.add("偏好");
  }
  if (/(粥|饭|菜|吃|喝|早餐|午餐|晚餐|水果|饮食)/.test(text)) {
    tags.add("饮食偏好");
  }
  if (memoryType === "health") {
    tags.add("健康");
  }
  if (memoryType === "habit") {
    tags.add("习惯");
  }
  if (memoryType === "location") {
    tags.add("地点");
  }
  return [...tags];
}

function normalizeTags(rawTags: unknown, fallbackTags: string[]) {
  if (!Array.isArray(rawTags)) {
    return fallbackTags;
  }
  const tags = rawTags.map((tag) => readString(tag)).filter((tag): tag is string => Boolean(tag));
  return tags.length ? [...new Set(tags)] : fallbackTags;
}

function readKnowledgeMemoryType(value: unknown): KnowledgeMemoryType | null {
  const text = readString(value);
  return knowledgeMemoryTypes.includes(text as KnowledgeMemoryType) ? (text as KnowledgeMemoryType) : null;
}

function readString(value: unknown) {
  return typeof value === "string" ? normalizeWhitespace(value) : "";
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
