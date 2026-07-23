import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { automationActions, automationPipelines, type AutomationActionId, type AutomationPipelineId } from "../automationRegistry";
import { detectDangerousOperation } from "../safetyGuard";
import { runAutomationAction, runAutomationPipeline } from "./automationRunner";
import { createFamilyRecordStore } from "./familyRecordStore";
import { extractResourceFiles } from "./resourceExtraction";

type FamilyToolOptions = {
  actorMemberId?: string | null;
  actorName?: string | null;
  dataDir?: string;
  familyId?: string | null;
};

type ParsedToolInput = {
  parameters: Record<string, unknown>;
  text: string;
};

const actionToolMap: Array<{
  actionId: AutomationActionId;
  description: string;
  name: string;
}> = [
  {
    actionId: "app.answer",
    description: "Answer questions about local family app data. Input JSON may include text and query_type.",
    name: "family_app_answer"
  },
  {
    actionId: "app.chat",
    description: "Reply to casual family assistant chat using local context and conversation memory. Input JSON may include text and session_id.",
    name: "family_app_chat"
  },
  {
    actionId: "app.runtime.inspect",
    description: "Read a small, redacted runtime summary filtered by hours, component, level, and error_type. Never returns chat bodies, secrets, or the full log.",
    name: "family_app_runtime_inspect"
  },
  {
    actionId: "profile.describe",
    description: "Describe a family member profile. Input JSON may include text and member.",
    name: "family_profile_describe"
  },
  {
    actionId: "web.search.duckduckgo",
    description: "Search the web with DuckDuckGo. Input JSON may include text, query, and max_results.",
    name: "family_web_search_duckduckgo"
  }
];

const pipelineToolMap: Array<{
  description: string;
  name: string;
  pipelineId: AutomationPipelineId;
}> = [];

const resourceToolNames = ["family_parse_resource", "family_image_ocr"] as const;
const resourceToolSchema = z.object({
  record_id: z.string().trim().min(1).describe("家庭资料记录 ID")
});

export function createFamilyAutomationTools(options: FamilyToolOptions = {}) {
  const actionTools = actionToolMap.map(({ actionId, description, name }) =>
    tool(
      async (input) => {
        const parsed = parseToolInput(input);
        assertSafeToolInput(parsed.text);
        const result = await runAutomationAction(actionId, {
          actorMemberId: options.actorMemberId ?? null,
          actorName: options.actorName ?? null,
          dataDir: options.dataDir,
          parameters: parsed.parameters
        });
        return JSON.stringify(result);
      },
      {
        description,
        name
      }
    )
  );

  const pipelineTools = pipelineToolMap.map(({ description, name, pipelineId }) =>
    tool(
      async (input) => {
        const parsed = parseToolInput(input);
        assertSafeToolInput(parsed.text);
        const result = await runAutomationPipeline(pipelineId, {
          actorMemberId: options.actorMemberId ?? null,
          actorName: options.actorName ?? null,
          dataDir: options.dataDir,
          parameters: parsed.parameters
        });
        return JSON.stringify(result);
      },
      {
        description,
        name
      }
    )
  );

  const resourceTools = [
    tool(
      async ({ record_id }) => JSON.stringify(await parseStoredResource(options, record_id, false)),
      {
        description: "Read-only local parser for an existing family resource. Extracts text from PDFs and office files, and uses OCR for images or scanned PDFs. Never changes profiles, memories, tasks, or records.",
        name: resourceToolNames[0],
        schema: resourceToolSchema
      }
    ),
    tool(
      async ({ record_id }) => JSON.stringify(await parseStoredResource(options, record_id, true)),
      {
        description: "Read-only OCR for images attached to an existing family resource. Returns visible text with confidence and source record ID. It does not infer people, health conditions, or intent.",
        name: resourceToolNames[1],
        schema: resourceToolSchema
      }
    )
  ];

  return [...actionTools, ...pipelineTools, ...resourceTools];
}

export function listFamilyAutomationToolNames() {
  return [
    ...actionToolMap.map((item) => item.name),
    ...pipelineToolMap.map((item) => item.name),
    ...resourceToolNames
  ];
}

export function resolveFamilyToolTarget(toolName: string) {
  const action = actionToolMap.find((item) => item.name === toolName);
  if (action && automationActions.some((item) => item.id === action.actionId)) {
    return {
      id: action.actionId,
      kind: "action" as const
    };
  }

  const pipeline = pipelineToolMap.find((item) => item.name === toolName);
  if (pipeline && automationPipelines.some((item) => item.id === pipeline.pipelineId)) {
    return {
      id: pipeline.pipelineId,
      kind: "pipeline" as const
    };
  }

  if (resourceToolNames.includes(toolName as typeof resourceToolNames[number])) {
    return {
      id: toolName,
      kind: "resource" as const
    };
  }

  return null;
}

async function parseStoredResource(options: FamilyToolOptions, recordId: string, imagesOnly: boolean) {
  const familyId = options.familyId?.trim();
  if (!familyId) throw new Error("资源解析 Tool 缺少家庭范围，已拒绝读取。");
  const records = await createFamilyRecordStore().list(familyId);
  const record = records.find((candidate) => candidate.id === recordId);
  if (!record) throw new Error("没有找到这条家庭资料。");
  const files = (record.sourceFiles || []).filter((file) => !imagesOnly || isImageResource(file));
  if (!files.length) throw new Error(imagesOnly ? "这条资料没有可 OCR 的图片。" : "这条资料没有可解析的附件。");
  const result = await extractResourceFiles(files.map((file) => ({
    name: file.name,
    originalUrl: file.originalUrl,
    size: file.size,
    type: file.type,
    url: file.url
  })), { dataDir: options.dataDir });
  return {
    content: result.text.slice(0, 24_000),
    files: result.files.map((file) => ({
      confidence: file.confidence,
      method: file.method,
      name: file.name,
      pageCount: file.pageCount,
      textLength: file.text.length
    })),
    readOnly: true,
    record: { id: record.id, title: record.title },
    sourceIds: [record.id],
    textLength: result.textLength,
    usedOcr: result.usedOcr
  };
}

function isImageResource(file: { name: string; type?: string }) {
  return /^image\//i.test(file.type || "") || /\.(?:avif|heic|heif|jpe?g|png|webp)$/i.test(file.name);
}

function parseToolInput(input: unknown): ParsedToolInput {
  const parameters = parseParameters(input);
  const text = readString(parameters.text) || readString(parameters.query);
  return {
    parameters: {
      ...parameters,
      text
    },
    text
  };
}

function parseParameters(input: unknown): Record<string, unknown> {
  if (!input) {
    return {};
  }

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) {
      return {};
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : { text: trimmed };
    } catch {
      return { text: trimmed };
    }
  }

  if (typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }

  return {
    text: String(input)
  };
}

function assertSafeToolInput(text: string) {
  const dangerousOperation = detectDangerousOperation(text);
  if (dangerousOperation) {
    throw new Error(`危险操作已被 LangChain tool 前置拦截：${dangerousOperation.reason}`);
  }
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
