import { appendFile, mkdir, readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getGuestChatSlug } from "@/lib/guestChat";
import { FamilyRequestContextError, requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { createRegisteredGuestInviteAccess, revokeRegisteredGuestInviteAccess } from "@/lib/server/guestChatAccess";

export const runtime = "nodejs";

const registryPath = "data/guest-chat-invites.jsonl";

export async function POST(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const id = readString(body.id).slice(0, 120);
    const inviteLink = readString(body.inviteLink);
    const title = readString(body.title).slice(0, 80);
    const slug = getGuestChatSlug(inviteLink);
    if (!id || !title || !/^https?:\/\/[^/]+\/guest\/chat\/[A-Za-z0-9_-]{16,}$/.test(inviteLink) || !/^[A-Za-z0-9_-]{16,}$/.test(slug)) {
      return NextResponse.json({ detail: "群聊邀请数据不完整。" }, { status: 400 });
    }
    const room = {
      id,
      familyId: context.familyId,
      spaceId: readString(body.spaceId) || undefined,
      title,
      inviteLink,
      chatMembers: readStringArray(body.chatMembers, 30),
      chatMessages: Array.isArray(body.chatMessages) ? body.chatMessages.slice(-100) : []
    };
    const latest = await readLatestInvite(slug);
    if (!latest || JSON.stringify(latest.room) !== JSON.stringify(room)) {
      await mkdir("data", { recursive: true });
      await appendFile(registryPath, `${JSON.stringify({ room, savedAt: new Date().toISOString(), slug })}\n`, "utf8");
    }
    if (body.create_access === true) {
      const invite = await createRegisteredGuestInviteAccess(slug);
      if (!invite) return NextResponse.json({ detail: "群聊邀请创建失败。" }, { status: 503 });
      return NextResponse.json({ invite, ok: true, slug }, { status: 201 });
    }
    return NextResponse.json({ ok: true, slug });
  } catch (error) {
    if (error instanceof FamilyRequestContextError) return NextResponse.json({ detail: error.message }, { status: error.status });
    return NextResponse.json({ detail: "群聊邀请登记失败。" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const inviteId = readString(body.invite_id);
    const slug = readString(body.slug);
    if (!inviteId || !/^[A-Za-z0-9_-]{16,}$/.test(slug)) {
      return NextResponse.json({ detail: "群聊邀请数据不完整。" }, { status: 400 });
    }
    const revoked = await revokeRegisteredGuestInviteAccess({ familyId: context.familyId, id: inviteId, slug });
    if (!revoked) return NextResponse.json({ detail: "邀请不存在。" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof FamilyRequestContextError) return NextResponse.json({ detail: error.message }, { status: error.status });
    return NextResponse.json({ detail: "撤销邀请失败。" }, { status: 500 });
  }
}

async function readLatestInvite(slug: string) {
  try {
    const lines = (await readFile(registryPath, "utf8")).trim().split(/\n+/).reverse();
    for (const line of lines) {
      const row = JSON.parse(line) as { slug?: string; room?: Record<string, unknown> };
      if (row.slug === slug && row.room) return row;
    }
  } catch {
    // The registry is created by the first external invitation.
  }
  return null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(value: unknown, limit: number) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, limit) : [];
}
