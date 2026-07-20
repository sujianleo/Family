import { appendFile, mkdir, readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { createRawEvent } from "@/lib/server/eventStore";
import { readGuestChatSession, resolveGuestChatRoom } from "@/lib/server/guestChatAccess";
import type { Json } from "@/lib/types";

export const runtime = "nodejs";

const metaDbFilePath = "data/meta-events.jsonl";
const allowedTypes = new Set(["group_chat_message", "group_attachment_selected"]);

export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("slug")?.trim() || "";
  const access = await requireGuestRoom(request, slug);
  if (!access.ok) return access.response;
  const events = await readEvents();
  return NextResponse.json({ events: events.filter((event) => event.record_id === access.room.id && allowedTypes.has(event.type)) }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { slug?: unknown; type?: unknown; text?: unknown; actor_name?: unknown; metadata?: unknown };
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const access = await requireGuestRoom(request, slug);
  if (!access.ok) return access.response;
  const type = typeof body.type === "string" ? body.type : "";
  if (!allowedTypes.has(type)) return NextResponse.json({ detail: "不支持的群聊消息类型。" }, { status: 400 });
  const messageText = typeof body.text === "string" ? body.text.trim().slice(0, 4000) : "";
  if (!messageText) return NextResponse.json({ detail: "消息不能为空。" }, { status: 400 });
  const actorName = typeof body.actor_name === "string" && body.actor_name.trim() ? body.actor_name.trim().slice(0, 24) : access.session.displayName;
  const metadata = isJson(body.metadata) ? body.metadata : null;
  const event: GuestStoredEvent = {
    id: `meta-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    actor_member_id: access.session.id,
    actor_name: actorName,
    record_id: access.room.id,
    space_id: access.room.spaceId || null,
    text: messageText,
    metadata,
    created_at: new Date().toISOString()
  };
  await mkdir("data", { recursive: true });
  await appendFile(metaDbFilePath, `${JSON.stringify(event)}\n`, "utf8");
  await createRawEvent({ actorMemberId: access.session.id, actorName, familyId: access.room.familyId, rawPayload: { metadata, record_id: access.room.id, type }, rawText: messageText, serverMetadata: { entrypoint: "/api/guest-chat/messages", phone_last4: access.session.phoneLast4 }, sourceSpaceId: access.room.spaceId, sourceType: type === "group_chat_message" ? "group_chat" : "upload" });
  return NextResponse.json({ id: event.id });
}

async function requireGuestRoom(request: Request, slug: string) {
  const session = readGuestChatSession(request, slug);
  if (!session) return { ok: false as const, response: NextResponse.json({ detail: "访客会话已过期，请重新输入手机号和口令。" }, { status: 401 }) };
  const room = await resolveGuestChatRoom(slug);
  if (!room || room.id !== session.recordId) return { ok: false as const, response: NextResponse.json({ detail: "这个群聊邀请已失效。" }, { status: 404 }) };
  return { ok: true as const, room, session };
}

async function readEvents() {
  try {
    const content = await readFile(metaDbFilePath, "utf8");
    return content.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line) as GuestStoredEvent);
  } catch {
    return [];
  }
}

type GuestStoredEvent = { id: string; type: string; actor_member_id: string | null; actor_name: string | null; record_id: string | null; space_id: string | null; text: string; metadata: Json; created_at: string };

function isJson(value: unknown): value is Json {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.every(isJson);
  return Boolean(value && typeof value === "object" && Object.values(value).every(isJson));
}
