import { NextResponse } from "next/server";
import { InviteAccessError, revokeInvite } from "@/lib/server/inviteAccess";
import { FamilyRequestContextError, requireFamilyRequestContext } from "@/lib/server/familyRequestContext";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ inviteId: string }> }) {
  try {
    const [{ inviteId }, context] = await Promise.all([params, requireFamilyRequestContext(request)]);
    const body = await request.json().catch(() => ({})) as { actor_name?: unknown };
    const result = await revokeInvite({ actorMemberId: context.memberId, actorName: typeof body.actor_name === "string" ? body.actor_name.trim() : "", familyId: context.familyId, inviteId });
    return NextResponse.json({ invite: result, ok: true });
  } catch (error) {
    if (error instanceof InviteAccessError || error instanceof FamilyRequestContextError) return NextResponse.json({ detail: error.message }, { status: error.status });
    return NextResponse.json({ detail: "撤销邀请失败。" }, { status: 500 });
  }
}
