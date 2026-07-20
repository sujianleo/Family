import { NextResponse } from "next/server";
import { createRawEvent } from "@/lib/server/eventStore";
import { authenticateGuestChat, guestSessionCookie, readGuestChatSession, resolveGuestChatRoom, restoreAuthenticatedGuestChat } from "@/lib/server/guestChatAccess";

export const runtime = "nodejs";

const attempts = new Map<string, { count: number; lockedUntil: number; startedAt: number }>();

export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("slug")?.trim() || "";
  const session = readGuestChatSession(request, slug);
  if (!session) {
    const restored = await restoreAuthenticatedGuestChat(request, slug);
    if (!restored) return NextResponse.json({ detail: "请先验证邀请并登录账号。" }, { status: 401 });
    const response = NextResponse.json({ identity: restored.identity, room: restored.room }, { headers: { "cache-control": "no-store" } });
    const cookie = guestSessionCookie(request, restored.token, slug, restored.maxAge);
    response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  }
  const room = await resolveGuestChatRoom(slug);
  if (!room || room.id !== session.recordId) return NextResponse.json({ detail: "这个群聊邀请已失效。" }, { status: 404 });
  return NextResponse.json({ identity: toIdentity(session), room }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { phone?: unknown; code?: unknown; slug?: unknown };
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const attemptKey = `${clientIp(request)}:${slug}`;
  if (isLocked(attemptKey)) return NextResponse.json({ detail: "口令尝试次数过多，请稍后再试。" }, { status: 429 });
  const result = await authenticateGuestChat(typeof body.phone === "string" ? body.phone : "", typeof body.code === "string" ? body.code : "", slug);
  if (!result.ok) {
    recordFailure(attemptKey);
    return NextResponse.json({ detail: result.detail }, { status: result.status });
  }
  attempts.delete(attemptKey);
  await createRawEvent({ actorMemberId: result.identity.id, actorName: result.identity.displayName, familyId: result.room.familyId, rawPayload: { guest_id: result.identity.id, phone_last4: result.identity.phoneLast4, record_id: result.room.id }, rawText: "访客通过手机号和群聊口令进入群聊", serverMetadata: { entrypoint: "/api/guest-chat/session" }, sourceSpaceId: result.room.spaceId, sourceType: "guest_chat_joined" });
  const response = NextResponse.json({ identity: result.identity, room: result.room });
  const cookie = guestSessionCookie(request, result.token, slug, result.maxAge);
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  response.headers.set("cache-control", "no-store");
  return response;
}

function toIdentity(session: { id: string; displayName: string; phoneLast4: string }) {
  return { id: session.id, displayName: session.displayName, phoneLast4: session.phoneLast4 };
}

function clientIp(request: Request) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function isLocked(key: string) {
  return (attempts.get(key)?.lockedUntil || 0) > Date.now();
}

function recordFailure(key: string) {
  const now = Date.now();
  const previous = attempts.get(key);
  const entry = !previous || now - previous.startedAt > 15 * 60_000 ? { count: 0, lockedUntil: 0, startedAt: now } : previous;
  entry.count += 1;
  if (entry.count >= 8) entry.lockedUntil = now + 15 * 60_000;
  attempts.set(key, entry);
}
