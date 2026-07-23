import { NextResponse } from "next/server";
import { isLiteBackend } from "@/lib/server/familyBackend";
import { requireFamilyRequestContext, FamilyRequestContextError } from "@/lib/server/familyRequestContext";
import { createPasswordHash } from "@/lib/server/localAuth";
import { updateLiteAccountPassword } from "@/lib/server/liteRepository";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    if (!isLiteBackend()) return NextResponse.json({ detail: "这个接口仅用于 Fanmili 本地服务。" }, { status: 404 });
    const body = await request.json().catch(() => ({})) as { password?: unknown };
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < 8 || password.length > 72) return NextResponse.json({ detail: "密码需为 8–72 个字符。" }, { status: 400 });
    const changed = updateLiteAccountPassword({
      familyId: context.familyId,
      memberId: context.memberId,
      passwordHash: await createPasswordHash(password)
    });
    if (!changed) return NextResponse.json({ detail: "当前账号不存在。" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof FamilyRequestContextError) return NextResponse.json({ detail: error.message }, { status: error.status });
    return NextResponse.json({ detail: "密码修改失败，请重试。" }, { status: 500 });
  }
}
