import { NextResponse } from "next/server";
import { normalizePhoneNumber } from "@/lib/phoneAuth";
import { createPasswordHash } from "@/lib/server/localAuth";
import { createLiteInstallation, readLiteInstallation } from "@/lib/server/liteRepository";

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

function readText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
