import { appendFile, mkdir, readFile } from "node:fs/promises";
import { DEFAULT_ASSISTANT_NAME } from "../assistantIdentity";
import { createRawEvent } from "./eventStore";
import { invokeDeepSeekText } from "./langchainAi";
import { readFamilyMembersWithOverrides } from "./memberOverrides";

export type ConversationTurn = {
  actorMemberId?: string | null;
  actorName?: string | null;
  assistantText: string;
  createdAt: string;
  userText: string;
};

export type ConversationContext = {
  activeTurns: ConversationTurn[];
  sessionId: string;
  summaryText: string;
};

type StoredMetaEvent = {
  created_at: string;
  id: string;
  metadata?: {
    actorMemberId?: string | null;
    actorName?: string | null;
    assistantText?: string;
    sessionId?: string;
    source?: string;
    summaryText?: string;
    turnCount?: number;
    userText?: string;
  };
  text: string;
  type: string;
};

const defaultWindowMs = 10 * 60 * 1000;

export async function prepareConversationContext(options: {
  actorMemberId?: string;
  dataDir: string;
  now?: Date;
  sessionId: string;
  windowMs?: number;
}): Promise<ConversationContext> {
  const now = options.now || new Date();
  const windowMs = options.windowMs || defaultWindowMs;
  const events = await readConversationEvents(options.dataDir, options.sessionId);
  const turns = events
    .filter(isConversationTurn)
    .map(toConversationTurn);
  const summaries = events.filter(isConversationSummary);
  const latestSummary = summaries.at(-1);
  const latestSummaryAt = latestSummary ? new Date(latestSummary.created_at).getTime() : 0;
  const turnsAfterSummary = turns.filter((turn) => new Date(turn.createdAt).getTime() > latestSummaryAt);
  const latestTurn = turnsAfterSummary.at(-1);
  const expired = latestTurn ? now.getTime() - new Date(latestTurn.createdAt).getTime() > windowMs : false;

  if (expired && turnsAfterSummary.length) {
    const summaryText = await summarizeConversationTurns(latestSummary?.metadata?.summaryText || "", turnsAfterSummary);
    await appendConversationEvent(options.dataDir, {
      type: "app_chat_summary",
      text: summaryText,
      metadata: {
        sessionId: options.sessionId,
        summaryText,
        turnCount: turnsAfterSummary.length
      },
      created_at: now.toISOString()
    });
    return {
      activeTurns: [],
      sessionId: options.sessionId,
      summaryText
    };
  }

  return {
    activeTurns: turnsAfterSummary.slice(-8),
    sessionId: options.sessionId,
    summaryText: latestSummary?.metadata?.summaryText || ""
  };
}

export async function appendConversationTurn(options: {
  actorMemberId?: string | null;
  actorName?: string | null;
  assistantText: string;
  dataDir: string;
  familyId?: string | null;
  now?: Date;
  recordDailyLog?: boolean;
  sessionId: string;
  userText: string;
}) {
  const createdAt = (options.now || new Date()).toISOString();
  await appendConversationEvent(options.dataDir, {
    type: "app_chat_turn",
    text: options.userText,
    metadata: {
      actorMemberId: options.actorMemberId || null,
      actorName: options.actorName || null,
      assistantText: options.assistantText,
      sessionId: options.sessionId,
      userText: options.userText
    },
    created_at: createdAt
  });
  if (options.recordDailyLog !== false) {
    await appendConversationEvent(options.dataDir, {
      type: "daily_life_log",
      text: options.userText,
      metadata: {
        actorMemberId: options.actorMemberId || null,
        actorName: options.actorName || null,
        sessionId: options.sessionId,
        source: "conversationMemory.appendConversationTurn",
        userText: options.userText
      },
      created_at: createdAt
    });
    await createRawEvent({
      actorMemberId: options.actorMemberId || null,
      actorName: options.actorName || null,
      familyId: options.familyId || null,
      conversationId: options.sessionId,
      dataDir: options.dataDir,
      rawPayload: {
        actor_member_key: options.actorMemberId || null,
        created_at: createdAt,
        session_id: options.sessionId,
        source: "conversationMemory.appendConversationTurn"
      },
      rawText: options.userText,
      serverMetadata: {
        entrypoint: "conversationMemory.appendConversationTurn"
      },
      sourceType: "user_daily_input"
    });
  }
  const assistantName = (await readFamilyMembersWithOverrides(options.dataDir))
    .find((member) => member.id === "fanmili")?.displayName || DEFAULT_ASSISTANT_NAME;
  await createRawEvent({
    actorMemberId: "fanmili",
    actorName: assistantName,
    familyId: options.familyId || null,
    conversationId: options.sessionId,
    dataDir: options.dataDir,
    rawPayload: {
      assistant_member_key: "fanmili",
      created_at: createdAt,
      session_id: options.sessionId,
      user_text: options.userText
    },
    rawText: options.assistantText,
    serverMetadata: {
      entrypoint: "conversationMemory.appendConversationTurn"
    },
    sourceType: "assistant_output"
  });
}

async function summarizeConversationTurns(previousSummary: string, turns: ConversationTurn[]) {
  const transcript = turns
    .map((turn) => `${turn.actorName || turn.actorMemberId || "当前成员"}：${turn.userText}\n助手：${turn.assistantText}`)
    .join("\n\n");
  try {
    const summary = await invokeDeepSeekText(
      [
        {
          role: "system",
          content:
            "你是家庭 App 的对话记忆压缩器。请把连续对话压缩为后续可复用的短上下文，保留用户偏好、明确事实、未完成事项和称呼变化。不要编造。输出 120 字以内中文摘要。"
        },
        {
          role: "user",
          content: JSON.stringify({
            previous_summary: previousSummary,
            conversation: transcript
          })
        }
      ],
      {
        maxTokens: 220,
        temperature: 0.1,
        timeoutMs: Number(process.env.DEEPSEEK_SUMMARY_TIMEOUT_MS || process.env.DEEPSEEK_TIMEOUT_MS || 5000)
      }
    );
    if (summary) {
      return summary;
    }
  } catch {
    // Fall back to deterministic compression so memory never blocks chat.
  }
  const compact = turns.map((turn) => `用户说${turn.userText}，助手答${turn.assistantText}`).join("；");
  return [previousSummary, compact].filter(Boolean).join("；").slice(0, 180);
}

async function readConversationEvents(dataDir: string, sessionId: string): Promise<StoredMetaEvent[]> {
  try {
    const content = await readFile(`${dataDir}/meta-events.jsonl`, "utf8");
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as StoredMetaEvent)
      .filter((event) => event.metadata?.sessionId === sessionId && (event.type === "app_chat_turn" || event.type === "app_chat_summary"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function appendConversationEvent(dataDir: string, event: Omit<StoredMetaEvent, "id">) {
  await mkdir(dataDir, { recursive: true });
  await appendFile(
    `${dataDir}/meta-events.jsonl`,
    `${JSON.stringify({
      id: `meta-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...event,
      actor_member_id: null,
      actor_name: null,
      record_id: null,
      space_id: null
    })}\n`,
    "utf8"
  );
}

function isConversationTurn(event: StoredMetaEvent) {
  return event.type === "app_chat_turn" && typeof event.metadata?.userText === "string" && typeof event.metadata?.assistantText === "string";
}

function isConversationSummary(event: StoredMetaEvent) {
  return event.type === "app_chat_summary" && typeof event.metadata?.summaryText === "string";
}

function toConversationTurn(event: StoredMetaEvent): ConversationTurn {
  return {
    actorMemberId: event.metadata?.actorMemberId || null,
    actorName: event.metadata?.actorName || null,
    assistantText: event.metadata?.assistantText || "",
    createdAt: event.created_at,
    userText: event.metadata?.userText || event.text
  };
}
