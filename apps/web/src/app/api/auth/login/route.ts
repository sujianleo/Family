import { NextResponse } from "next/server";
import { authenticateLocalLogin, isLocalAuthConfigured, sessionCookie } from "@/lib/server/localAuth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isLocalAuthConfigured()) return NextResponse.json({ detail: "登录服务尚未配置。" }, { status: 503 });
  const body = await request.json().catch(() => ({})) as { phone?: unknown; password?: unknown };
  const result = await authenticateLocalLogin(typeof body.phone === "string" ? body.phone : "", typeof body.password === "string" ? body.password : "", request);
  if (!result.ok) return NextResponse.json({ detail: result.rateLimited ? "尝试次数过多，请稍后再试。" : "手机号或密码不正确。" }, { status: result.rateLimited ? 429 : 401 });
  const response = NextResponse.json({ ok: true, role: result.role });
  const cookie = sessionCookie(request, result.token, result.maxAge);
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  response.headers.set("cache-control", "no-store");
  return response;
}
