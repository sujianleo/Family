import { NextResponse } from "next/server";
import { normalizePhoneNumber } from "@/lib/phoneAuth";
import { isLiteBackend } from "@/lib/server/familyBackend";
import { createPasswordHash } from "@/lib/server/localAuth";
import { createLiteInstallation, readLiteInstallation } from "@/lib/server/liteRepository";
import { createServiceSupabaseClient } from "@/lib/server/supabaseServer";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ detail: "请求格式不正确。" }, { status: 415 });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const displayName = readText(body.displayName);
  const familyName = readText(body.familyName);
  const phone = normalizePhoneNumber(readText(body.phone));
  const password = readText(body.password);
  if (!displayName || displayName.length > 40) return NextResponse.json({ detail: "请输入 1–40 个字的名字。" }, { status: 400 });
  if (!familyName || familyName.length > 40) return NextResponse.json({ detail: "请输入 1–40 个字的家庭名称。" }, { status: 400 });
  if (!phone) return NextResponse.json({ detail: "请输入正确的手机号。" }, { status: 400 });
  if (password.length < 8 || password.length > 72) return NextResponse.json({ detail: "密码需为 8–72 个字符。" }, { status: 400 });

  if (isLiteBackend()) {
    if (readLiteInstallation()) return NextResponse.json({ detail: "这个家庭已经创建，请直接登录。" }, { status: 409 });
    try {
      createLiteInstallation({ displayName, familyName, passwordHash: await createPasswordHash(password), phone });
      return NextResponse.json({ backend: "sqlite", ok: true }, { status: 201 });
    } catch (error) {
      if (error instanceof Error && error.message === "LITE_ALREADY_INITIALIZED") {
        return NextResponse.json({ detail: "这个家庭已经创建，请直接登录。" }, { status: 409 });
      }
      return NextResponse.json({ detail: "创建本地家庭失败，请检查数据目录权限后重试。" }, { status: 500 });
    }
  }

  const service = createServiceSupabaseClient();
  if (!service) return NextResponse.json({ detail: "本地 Supabase 尚未连接。" }, { status: 503 });

  const { data: installation, error: statusError } = await service.from("app_installation").select("id").eq("id", 1).maybeSingle();
  if (statusError) return NextResponse.json({ detail: "数据库尚未初始化，请运行本地部署脚本。" }, { status: 503 });
  if (installation) return NextResponse.json({ detail: "这个家庭已经创建，请直接登录。" }, { status: 409 });

  const { data: authData, error: authError } = await service.auth.admin.createUser({
    password,
    phone,
    phone_confirm: true,
    user_metadata: { display_name: displayName }
  });
  if (authError || !authData.user) {
    const duplicate = /already|registered|exists/i.test(authError?.message || "");
    return NextResponse.json({ detail: duplicate ? "这个手机号已经注册，请直接登录。" : "创建管理员账号失败，请重试。" }, { status: duplicate ? 409 : 500 });
  }

  const { error: bootstrapError } = await service.rpc("bootstrap_family_admin", {
    p_display_name: displayName,
    p_family_name: familyName,
    p_user_id: authData.user.id
  });
  if (bootstrapError) {
    await service.auth.admin.deleteUser(authData.user.id).catch(() => undefined);
    const initialized = /already been initialized/i.test(bootstrapError.message);
    return NextResponse.json({ detail: initialized ? "这个家庭已经创建，请直接登录。" : "创建家庭失败，请重试。" }, { status: initialized ? 409 : 500 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

function readText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
