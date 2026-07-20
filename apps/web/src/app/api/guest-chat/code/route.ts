import { NextResponse } from "next/server";
import { FamilyRequestContextError, requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { getHourlyGuestChatCode, guestCodeValidUntil, resolveGuestChatRoom } from "@/lib/server/guestChatAccess";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const slug = new URL(request.url).searchParams.get("slug")?.trim() || "";
    const room = await resolveGuestChatRoom(slug);
    if (!room || room.familyId !== context.familyId) return NextResponse.json({ detail: "找不到这个外部群聊。" }, { status: 404 });
    return NextResponse.json({ code: getHourlyGuestChatCode(slug), validUntil: guestCodeValidUntil() }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof FamilyRequestContextError) return NextResponse.json({ detail: error.message }, { status: error.status });
    return NextResponse.json({ detail: "暂时无法读取群聊口令。" }, { status: 500 });
  }
}
