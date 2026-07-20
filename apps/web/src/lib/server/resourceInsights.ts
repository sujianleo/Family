import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { resolveFamilyMemberMention } from "../assignment";
import { familyMembers } from "../mockData";
import type { FamilyMember } from "../types";
import { writeMemberProfiles } from "./memberProfiles";

type ResourceInsightFile = {
  name: string;
  originalUrl?: string;
  size?: number;
  text?: string;
  type?: string;
  url?: string;
};

type ResourceInsightPayload = {
  actorMemberId?: string;
  actorName?: string;
  recordId?: string;
  resourceTitle?: string;
  sourceFiles?: ResourceInsightFile[];
  spaceId?: string;
};

type ResourceInsightOptions = {
  dataDir?: string;
  now?: Date;
  refreshProfiles?: boolean;
  useAiProfiles?: boolean;
};

const defaultDataDir = "data";
const maxDocumentExtractionBytes = 20 * 1024 * 1024;

export async function processResourceInsight(payload: ResourceInsightPayload, options: ResourceInsightOptions = {}) {
  const dataDir = options.dataDir || defaultDataDir;
  const now = options.now || new Date();
  const sourceFiles = payload.sourceFiles || [];
  const extractedTexts = await Promise.all(sourceFiles.map((file) => extractSourceFileText(file, dataDir)));
  const rawContentText = extractedTexts.filter(Boolean).join("\n").trim();
  const contentText = compactText(rawContentText);
  const targetMembers = resolveMentionedMembers(rawContentText);
  const insightKind = detectResourceInsightKind(rawContentText);

  const resourceTitle = payload.resourceTitle || "未命名资料";
  if (!contentText) {
    const question = `我没能从《${resourceTitle}》读取到可分析文字。它可能是扫描件、受密码保护或内容为空。请告诉我这份文件主要是什么，以及属于哪位家人？`;
    await appendResourceParsedEvent(dataDir, createResourceQuestionEvent(payload, now, question, "empty_extraction", ""));
    return {
      analysisText: "附件已保存，但文档解析没有取得可用文字。",
      insightKind,
      memberIds: [],
      question,
      status: "needs_clarification" as const,
      textLength: 0
    };
  }

  const factText = buildResourceFactText(resourceTitle, rawContentText);
  if ((insightKind === "health_checkup" || insightKind === "resume") && targetMembers?.length !== 1) {
    const question = targetMembers?.length
      ? `我识别出《${resourceTitle}》可能同时涉及多位家人。请确认这份${insightKind === "health_checkup" ? "体检报告" : "资料"}主要属于谁？`
      : `我已解析《${resourceTitle}》，但还不知道它属于哪位家人。请告诉我姓名或家庭称呼。`;
    await appendResourceParsedEvent(dataDir, createResourceQuestionEvent(payload, now, question, "member_unresolved", factText));
    return {
      analysisText: `已解析《${resourceTitle}》，识别为${insightKind === "health_checkup" ? "健康体检资料" : "简历资料"}，但归属尚未确认。`,
      insightKind,
      memberIds: targetMembers?.map((member) => member.id) || [],
      question,
      status: "needs_clarification" as const,
      textLength: contentText.length
    };
  }

  const eventMembers = targetMembers?.length
    ? targetMembers
    : [{
        avatarSeed: "",
        displayName: payload.actorName || "上传者",
        id: payload.actorMemberId || "me"
      } as FamilyMember];
  for (const member of eventMembers) {
    await appendResourceParsedEvent(dataDir, {
      actor_member_id: member.id,
      actor_name: member.displayName,
      created_at: now.toISOString(),
      id: `meta-${now.getTime()}-${member.id}-${Math.random().toString(36).slice(2, 8)}`,
      metadata: {
        action: "resource.parse_and_profile",
        fileNames: sourceFiles.map((file) => file.name),
        insightKind,
        requiresConfirmation: insightKind === "health_checkup",
        resourceTitle: payload.resourceTitle || "",
        subjectUnresolved: !targetMembers?.length,
        sensitiveCategory: insightKind === "health_checkup" ? "health" : undefined,
        sourceDisclaimer: insightKind === "health_checkup" && /虚构|测试数据|人工合成/.test(rawContentText)
          ? "synthetic_document_content"
          : undefined,
        textLength: contentText.length
      },
      record_id: payload.recordId || null,
      space_id: payload.spaceId || null,
      text: factText,
      type: "resource_parsed"
    });
  }

  if (options.refreshProfiles !== false) {
    await writeMemberProfiles({ dataDir, now, useAi: options.useAiProfiles ?? true });
  }

  return {
    analysisText: `已解析《${resourceTitle}》，识别为${formatInsightKind(insightKind)}，并加入 AI 分析记录。\n${factText}`.slice(0, 560),
    insightKind,
    memberIds: targetMembers?.map((member) => member.id) || [],
    status: "parsed" as const,
    textLength: contentText.length
  };
}

function resolveMentionedMembers(text: string) {
  if (!text) {
    return null;
  }

  const remainingMembers = [...familyMembers];
  const matchedMembers: FamilyMember[] = [];
  while (remainingMembers.length > 0) {
    const member = resolveFamilyMemberMention(text, remainingMembers);
    if (!member) break;
    matchedMembers.push(member);
    remainingMembers.splice(
      remainingMembers.findIndex((item) => item.id === member.id),
      1
    );
  }

  return matchedMembers.length ? matchedMembers : null;
}

async function extractSourceFileText(file: ResourceInsightFile, dataDir: string) {
  if (file.text?.trim()) {
    return file.text.trim();
  }

  const isPdf = isPdfFile(file);
  const isTextLike = isTextLikeFile(file);
  const isWordDocument = isWordDocumentFile(file);
  const isExcelDocument = isExcelDocumentFile(file);
  if (!isPdf && !isTextLike && !isWordDocument && !isExcelDocument) {
    return "";
  }

  if (file.size && file.size > maxDocumentExtractionBytes) {
    return "";
  }

  const buffer = await readUploadedFileBuffer(file, dataDir);
  if (!buffer) {
    return "";
  }

  if (buffer.length > maxDocumentExtractionBytes) {
    return "";
  }

  if (isPdf) {
    const pdfText = await extractPdfText(buffer);
    if (pdfText) {
      return pdfText;
    }
  }

  if (isTextLike) {
    return buffer.toString("utf8");
  }

  if (isWordDocument) {
    return extractOfficeText(buffer);
  }

  if (isExcelDocument) {
    return extractExcelText(buffer);
  }

  return "";
}

async function readUploadedFileBuffer(file: ResourceInsightFile, dataDir: string) {
  const fileUrl = file.originalUrl || file.url || "";
  if (!fileUrl) {
    return null;
  }

  try {
    const url = new URL(fileUrl, "http://family.local");
    if (url.pathname !== "/api/guest-uploads") {
      return null;
    }

    const tusId = sanitizeSegment(url.searchParams.get("tus") || "");
    if (tusId) {
      return readFile(path.join(dataDir, "tus-uploads", tusId));
    }

    const relativeFile = sanitizeRelativePath(url.searchParams.get("file") || "");
    if (relativeFile) {
      return readFile(path.join(dataDir, "guest-uploads", relativeFile));
    }
  } catch {
    return null;
  }

  return null;
}

async function extractPdfText(buffer: Buffer) {
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return compactText(result.text || "");
    } finally {
      await parser.destroy();
    }
  } catch {
    return "";
  }
}

async function extractOfficeText(buffer: Buffer) {
  try {
    const { parseOffice } = await import("officeparser");
    const document = await parseOffice(buffer);
    return compactText(document.toText());
  } catch {
    return "";
  }
}

async function extractExcelText(buffer: Buffer) {
  try {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(buffer, { type: "buffer" });
    return compactText(workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      return sheet ? `${sheetName}\n${XLSX.utils.sheet_to_csv(sheet)}` : "";
    }).filter(Boolean).join("\n"));
  } catch {
    return "";
  }
}

function buildResourceFactText(title: string, text: string) {
  const compact = compactText(text);
  if (detectResourceInsightKind(text) === "health_checkup") {
    return buildHealthCheckupFactText(title, compact);
  }
  const occupation = extractLabeledValue(text, ["求职意向", "应聘岗位", "目标岗位", "职业", "职位", "岗位"], 32);
  const skills = extractLabeledValue(text, ["技能", "专业技能", "核心技能"], 80);
  const experiences = extractLabeledValue(text, ["经历", "工作经历", "项目经历"], 80);
  const facts = [`资料：${title}`];
  if (/简历|求职|应聘|技能|经历|项目|教育|学历|毕业|岗位|职位/.test(compact)) {
    facts.push("简历资料");
  }
  if (occupation) facts.push(`求职意向：${occupation}`);
  if (skills) facts.push(`技能：${skills}`);
  if (experiences) facts.push(`经历：${experiences}`);

  if (facts.length <= 2 && compact) {
    facts.push(compact.slice(0, 160));
  }

  return facts.join("。");
}

function detectResourceInsightKind(text: string) {
  const compact = compactText(text);
  if (/(?:健康)?体检报告|实验室检查|空腹血糖|糖化血红蛋白|血压\s*\d{2,3}\s*\/\s*\d{2,3}/i.test(compact)) {
    return "health_checkup" as const;
  }
  if (/简历|求职|应聘|技能|工作经历|项目经历|学历/.test(compact)) {
    return "resume" as const;
  }
  return "document" as const;
}

function buildHealthCheckupFactText(title: string, text: string) {
  const facts = [`资料：${title}`, "健康体检报告"];
  const reportDate = captureValue(text, /(?:体检日期|检查日期|报告日期)\s*[:：]?\s*(20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}日?)/i);
  const memberLabel = captureValue(text, /家庭成员标识\s*[:：]?\s*([^，。；;\s]{1,12})/);
  if (memberLabel) facts.push(`家庭成员：${memberLabel}`);
  if (reportDate) facts.push(`体检日期：${reportDate}`);

  const abnormalMetrics = [
    captureMetric(text, "血压", /\d{2,3}\s*\/\s*\d{2,3}\s*mmHg/i),
    captureMetric(text, "空腹血糖", /\d+(?:\.\d+)?\s*mmol\/L/i),
    captureMetric(text, "糖化血红蛋白 HbA1c", /\d+(?:\.\d+)?%/i, ["糖化血红蛋白", "HbA1c"]),
    captureMetric(text, "总胆固醇 TC", /\d+(?:\.\d+)?\s*mmol\/L/i, ["总胆固醇"]),
    captureMetric(text, "低密度脂蛋白 LDL-C", /\d+(?:\.\d+)?\s*mmol\/L/i, ["低密度脂蛋白"]),
    captureMetric(text, "甘油三酯 TG", /\d+(?:\.\d+)?\s*mmol\/L/i, ["甘油三酯"]),
    captureMetric(text, "丙氨酸氨基转移酶 ALT", /\d+(?:\.\d+)?\s*U\/L/i, ["丙氨酸氨基转移酶", "ALT"]),
    captureMetric(text, "尿酸", /\d+(?:\.\d+)?\s*(?:μ|µ|u)mol\/L/i)
  ].filter((value): value is string => Boolean(value));
  if (abnormalMetrics.length) {
    facts.push(`报告标记异常：${abnormalMetrics.join("；")}`);
  }

  const imaging: string[] = [];
  if (/轻度脂肪肝/.test(text)) imaging.push("轻度脂肪肝表现");
  const thyroid = captureValue(text, /(TI-RADS\s*[1-5]\s*类(?:[^，。；;]{0,18})?)/i);
  if (thyroid) imaging.push(thyroid);
  if (imaging.length) facts.push(`影像提示：${imaging.join("；")}`);

  const followUps: string[] = [];
  if (/连续\s*7\s*天[^。；;]{0,28}(?:血压|记录)/.test(text)) followUps.push("连续 7 天早晚记录血压");
  if (/约\s*3\s*个月/.test(text)) followUps.push("约 3 个月复查血糖、HbA1c、血脂、尿酸和肝功能");
  if (/约\s*12\s*个月/.test(text)) followUps.push("约 12 个月复查甲状腺超声");
  if (followUps.length) facts.push(`报告建议：${followUps.join("；")}`);

  if (/虚构|测试数据|人工合成|非医疗证明|不是医学诊断/.test(text)) {
    facts.push("声明：虚构测试数据，非医学诊断，不对应真实个人");
  }
  return facts.join("。").slice(0, 480);
}

function captureMetric(text: string, label: string, valuePattern: RegExp, aliases: string[] = [label]) {
  const aliasPattern = aliases.map(escapeRegExp).join("|");
  const flags = valuePattern.flags.includes("i") ? "i" : "";
  const pattern = new RegExp(`(?:${aliasPattern})\\s*(?:[A-Z][A-Z0-9-]*\\s*)?(${valuePattern.source})`, flags);
  const match = pattern.exec(text);
  if (!match?.[1]) return "";
  const nearby = text.slice(match.index + match[0].length, match.index + match[0].length + 30);
  const hint = nearby.match(/(临界偏高|偏高|轻度异常|超重)/)?.[1];
  return hint ? `${label} ${compactText(match[1])}（${hint}）` : "";
}

function captureValue(text: string, pattern: RegExp) {
  return compactText(pattern.exec(text)?.[1] || "");
}

function extractLabeledValue(text: string, labels: string[], maxLength: number) {
  const allLabels = [
    "姓名",
    "求职意向",
    "应聘岗位",
    "目标岗位",
    "职业",
    "职位",
    "岗位",
    "技能",
    "专业技能",
    "核心技能",
    "经历",
    "工作经历",
    "项目经历",
    "教育",
    "教育经历",
    "学历"
  ];
  const boundary = `(?:${allLabels.map(escapeRegExp).join("|")})`;

  for (const label of labels) {
    const pattern = new RegExp(`${escapeRegExp(label)}[:：\\s]*([\\s\\S]{2,${maxLength}}?)(?=\\s*(?:${boundary})[:：]|[。.!！?？；;\\n\\r]|$)`);
    const value = compactText(text.match(pattern)?.[1] || "");
    if (value) {
      return value.slice(0, maxLength);
    }
  }

  return "";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function appendResourceParsedEvent(dataDir: string, event: Record<string, unknown>) {
  await mkdir(dataDir, { recursive: true });
  await appendFile(path.join(dataDir, "meta-events.jsonl"), `${JSON.stringify(event)}\n`, "utf8");
}

function createResourceQuestionEvent(
  payload: ResourceInsightPayload,
  now: Date,
  question: string,
  reason: "empty_extraction" | "member_unresolved",
  factText: string
) {
  return {
    actor_member_id: payload.actorMemberId || "me",
    actor_name: payload.actorName || "上传者",
    created_at: now.toISOString(),
    id: `meta-${now.getTime()}-resource-question-${Math.random().toString(36).slice(2, 8)}`,
    metadata: {
      action: "resource.parse_question",
      factText,
      fileNames: (payload.sourceFiles || []).map((file) => file.name),
      question,
      reason,
      resourceTitle: payload.resourceTitle || ""
    },
    record_id: payload.recordId || null,
    space_id: payload.spaceId || null,
    text: question,
    type: "resource_parse_question"
  };
}

function formatInsightKind(kind: "document" | "resume" | "health_checkup") {
  if (kind === "health_checkup") return "健康体检资料";
  if (kind === "resume") return "简历资料";
  return "普通文档";
}

function isPdfFile(file: ResourceInsightFile) {
  return /pdf/i.test(file.type || "") || /\.pdf$/i.test(file.name);
}

function isTextLikeFile(file: ResourceInsightFile) {
  return /^text\//i.test(file.type || "") || /\.(txt|md|csv|json)$/i.test(file.name);
}

function isWordDocumentFile(file: ResourceInsightFile) {
  return /\.docx$/i.test(file.name);
}

function isExcelDocumentFile(file: ResourceInsightFile) {
  return /\.xlsx$/i.test(file.name);
}

function compactText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function sanitizeRelativePath(value: string) {
  const normalized = path.normalize(decodeURIComponent(value)).replace(/^(\.\.[/\\])+/, "");
  return normalized
    .split(path.sep)
    .map(sanitizeSegment)
    .filter(Boolean)
    .join(path.sep);
}

function sanitizeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96);
}
