import { appendFile, mkdir, readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { createRawEvent } from "@/lib/server/eventStore";
import { FamilyRequestContextError, requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { parseTemporalExpression } from "@/lib/temporal";
import type { Json } from "@/lib/types";

type MetaEventPayload = {
  id?: string;
  type?: string;
  actor_member_id?: string;
  actor_name?: string;
  record_id?: string;
  space_id?: string;
  text?: string;
  metadata?: Json;
};

type StoredMetaEvent = {
  id: string;
  type: string;
  actor_member_id: string | null;
  actor_name: string | null;
  record_id: string | null;
  space_id: string | null;
  text: string;
  metadata: Json;
  created_at: string;
};

const metaDbDir = "data";
const metaDbFilePath = "data/meta-events.jsonl";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireFamilyRequestContext(request);
  } catch (error) {
    return requestContextErrorResponse(error);
  }
  const { searchParams } = new URL(request.url);
  const type = readString(searchParams.get("type"));
  const recordId = readString(searchParams.get("record_id"));
  const events = await readMetaEvents();

  return NextResponse.json({
    events: events.filter((event) => {
      if (type && event.type !== type) {
        return false;
      }

      if (recordId && event.record_id !== recordId) {
        return false;
      }

      return true;
    })
  });
}

export async function POST(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const body = (await request.json()) as MetaEventPayload;
    const type = readString(body.type);
    const text = readString(body.text);

    if (!type) {
      return NextResponse.json({ detail: "缺少 meta 事件类型。" }, { status: 400 });
    }

    const event: StoredMetaEvent = {
      id: readString(body.id) || `meta-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      actor_member_id: readString(body.actor_member_id) || null,
      actor_name: readString(body.actor_name) || null,
      record_id: readString(body.record_id) || null,
      space_id: readString(body.space_id) || null,
      text,
      metadata: isJsonValue(body.metadata) ? body.metadata : null,
      created_at: new Date().toISOString()
    };

    await createRawEvent({
      actorMemberId: context.memberId,
      actorName: event.actor_name,
      familyId: context.familyId,
      rawPayload: {
        metadata: event.metadata,
        record_id: event.record_id,
        space_id: event.space_id,
        type: event.type
      },
      rawText: event.text,
      serverMetadata: {
        entrypoint: "/api/meta-events",
        legacyMetaEventId: event.id
      },
      sourceSpaceId: event.space_id,
      sourceType: event.type === "group_chat_message" ? "group_chat" : event.type === "group_attachment_selected" ? "upload" : "meta_event"
    });
    await appendMetaEvent(event);
    await mirrorAppChatTurnEvent(event, context);
    return NextResponse.json({ id: event.id });
  } catch (error) {
    if (error instanceof FamilyRequestContextError) {
      return requestContextErrorResponse(error);
    }
    return NextResponse.json({ detail: error instanceof Error ? error.message : "meta 事件保存失败。" }, { status: 500 });
  }
}

function requestContextErrorResponse(error: unknown) {
  if (error instanceof FamilyRequestContextError) {
    return NextResponse.json({ detail: error.message }, { status: error.status });
  }
  return NextResponse.json({ detail: "家庭访问验证失败。" }, { status: 500 });
}

async function mirrorAppChatTurnEvent(event: StoredMetaEvent, context: { familyId: string; memberId: string }) {
  if (event.type !== "app_chat_turn") {
    return;
  }

  const metadata = isRecord(event.metadata) ? event.metadata : {};
  const sessionId = readString(metadata.sessionId);
  const userText = readString(metadata.userText) || event.text;
  const assistantText = readString(metadata.assistantText);
  if (!sessionId || !userText) {
    return;
  }
  const temporal = parseTemporalExpression(
    userText,
    new Date(event.created_at),
    readString(metadata.timeZone) || readString(metadata.time_zone) || "Asia/Shanghai",
    "record"
  );
  const temporalMetadata = {
    matchedText: temporal.matchedText,
    occurredAt: temporal.instant,
    occurredOn: temporal.occurredOn,
    precision: temporal.precision,
    timeZone: temporal.timeZone,
    requiresClarification: temporal.requiresClarification,
    clarificationMessage: temporal.clarificationMessage
  };

  await appendMetaEvent({
    id: `meta-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: "daily_life_log",
    actor_member_id: event.actor_member_id,
    actor_name: event.actor_name,
    record_id: event.record_id,
    space_id: event.space_id,
    text: userText,
    metadata: {
      actorMemberId: event.actor_member_id,
      actorName: event.actor_name,
      sessionId,
      source: "/api/meta-events.app_chat_turn",
      temporal: temporalMetadata,
      userText
    },
    created_at: event.created_at
  });
  await createRawEvent({
    actorMemberId: context.memberId,
    actorName: event.actor_name,
    conversationId: sessionId,
    familyId: context.familyId,
    rawPayload: {
      actor_member_key: event.actor_member_id,
      created_at: event.created_at,
      source: "/api/meta-events.app_chat_turn",
      temporal: temporalMetadata
    },
    rawText: userText,
    serverMetadata: {
      entrypoint: "/api/meta-events",
      legacyMetaEventId: event.id,
      temporal: temporalMetadata
    },
    sourceSpaceId: event.space_id,
    sourceType: "user_daily_input"
  });

  if (!assistantText) {
    return;
  }

  await createRawEvent({
    actorMemberId: "fanmili",
    actorName: "饭米粒",
    conversationId: sessionId,
    familyId: context.familyId,
    rawPayload: {
      assistant_member_key: "fanmili",
      created_at: event.created_at,
      source: "/api/meta-events.app_chat_turn",
      user_text: userText
    },
    rawText: assistantText,
    serverMetadata: {
      entrypoint: "/api/meta-events",
      parentMetaEventId: event.id
    },
    sourceSpaceId: event.space_id,
    sourceType: "assistant_output"
  });
}

async function readMetaEvents() {
  try {
    const content = await readFile(metaDbFilePath, "utf8");
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as StoredMetaEvent);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function appendMetaEvent(event: StoredMetaEvent) {
  await mkdir(metaDbDir, { recursive: true });
  await appendFile(metaDbFilePath, `${JSON.stringify(event)}\n`, "utf8");
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isJsonValue(value: unknown): value is Json {
  if (value === null) {
    return true;
  }

  if (["string", "number", "boolean"].includes(typeof value)) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every((item) => item === undefined || isJsonValue(item));
  }

  return false;
}
