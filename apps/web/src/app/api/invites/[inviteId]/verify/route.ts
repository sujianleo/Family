import { NextResponse } from "next/server";
import { InviteAccessError, readInvitePreview } from "@/lib/server/inviteAccess";
import { checkInviteRateLimit } from "@/lib/server/inviteRateLimit";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ inviteId: string }> }) {
  try {
    const { inviteId } = await params;
    const recordFailure = checkInviteRateLimit(request, inviteId, "verify");
    const body = await request.json().catch(() => ({})) as { code?: unknown };
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const invite = await readInvitePreview(inviteId, code);
    if (!invite.verified) {
      recordFailure();
      return NextResponse.json({ detail: "验证码不正确。" }, { status: 403 });
    }
    return NextResponse.json({ invite }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof InviteAccessError) return NextResponse.json({ detail: error.message }, { status: error.status });
    return NextResponse.json({ detail: "暂时无法验证邀请。" }, { status: 500 });
  }
}
