import { NextResponse } from "next/server";
import { createInvite, InviteAccessError } from "@/lib/server/inviteAccess";
import { FamilyRequestContextError, requireFamilyRequestContext } from "@/lib/server/familyRequestContext";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const type = body.type === "family" ? "family" : body.type === "group" ? "group" : null;
    if (!type) return NextResponse.json({ detail: "请选择邀请家人或邀请朋友加入群聊。" }, { status: 400 });
    const result = await createInvite({
      actorMemberId: context.memberId,
      actorName: readString(body.actor_name),
      familyId: context.familyId,
      maxUse: typeof body.max_use === "number" ? body.max_use : undefined,
      requestOrigin: publicOrigin(request),
      targetId: readString(body.target_id),
      targetName: readString(body.target_name),
      avatarSeed: readString(body.avatar_seed),
      relationshipLabel: readString(body.relationship_label),
      relationshipRole: readRelationshipRole(body.relationship_role),
      type
    });
    return NextResponse.json({ ok: true, invite: result }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

function publicOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.FAMILY_PUBLIC_URL;
  if (configured) return configured;
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host") || url.host;
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
  return `${protocol}://${host}`;
}
function readString(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function readRelationshipRole(value: unknown) { return value === "parent" || value === "child" || value === "spouse" ? value : "relative" as const; }
function errorResponse(error: unknown) {
  if (error instanceof InviteAccessError || error instanceof FamilyRequestContextError) return NextResponse.json({ detail: error.message }, { status: error.status });
  return NextResponse.json({ detail: "邀请创建失败。" }, { status: 500 });
}
