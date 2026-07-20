import { NextResponse } from "next/server";
import { InviteAccessError, readInvitePreview } from "@/lib/server/inviteAccess";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ inviteId: string }> }) {
  try {
    const { inviteId } = await params;
    return NextResponse.json({ invite: await readInvitePreview(inviteId) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof InviteAccessError) return NextResponse.json({ detail: error.message }, { status: error.status });
    return NextResponse.json({ detail: "暂时无法读取邀请。" }, { status: 500 });
  }
}
