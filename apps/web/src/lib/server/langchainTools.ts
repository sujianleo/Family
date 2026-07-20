import { tool } from "@langchain/core/tools";
import { automationActions, automationPipelines, type AutomationActionId, type AutomationPipelineId } from "../automationRegistry";
import { detectDangerousOperation } from "../safetyGuard";
import { runAutomationAction, runAutomationPipeline } from "./automationRunner";

type FamilyToolOptions = {
  actorMemberId?: string | null;
  actorName?: string | null;
  dataDir?: string;
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

  return [...actionTools, ...pipelineTools];
}

export function listFamilyAutomationToolNames() {
  return [
    ...actionToolMap.map((item) => item.name),
    ...pipelineToolMap.map((item) => item.name)
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

  return null;
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
