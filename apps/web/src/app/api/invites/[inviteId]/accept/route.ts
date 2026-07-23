import { NextResponse } from "next/server";
import { acceptInvite, InviteAccessError } from "@/lib/server/inviteAccess";
import { checkInviteRateLimit } from "@/lib/server/inviteRateLimit";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ inviteId: string }> }) {
  try {
    const { inviteId } = await params;
    const recordFailure = checkInviteRateLimit(request, inviteId, "accept");
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    try {
      const membership = await acceptInvite({
        avatarSeed: readString(body.avatar_seed),
        avatarUrl: readString(body.avatar_url),
        code: readString(body.code),
        displayName: readString(body.display_name),
        inviteId,
        password: readString(body.password),
        phone: readString(body.phone),
        request
      });
      return NextResponse.json({ membership, ok: true });
    } catch (error) {
      if (error instanceof InviteAccessError && error.status === 403) recordFailure();
      throw error;
    }
  } catch (error) {
    if (error instanceof InviteAccessError) return NextResponse.json({ detail: error.message }, { status: error.status });
    return NextResponse.json({ detail: "加入失败，请稍后再试。" }, { status: 500 });
  }
}

function readString(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
