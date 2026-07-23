import { NextResponse } from "next/server";
import { isLiteBackend } from "@/lib/server/familyBackend";
import { requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { readLiteAiConfig, saveLiteAiConfig } from "@/lib/server/liteAiConfig";
import { isLocalAuthConfigured, readLocalSession } from "@/lib/server/localAuth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  await requireFamilyRequestContext(request);
  if (!isLiteBackend()) return NextResponse.json({ detail: "这个接口仅用于 Fanmili 本地服务。" }, { status: 404 });
  return NextResponse.json({
    configured: Boolean(process.env.DEEPSEEK_API_KEY?.trim() || readLiteAiConfig()),
    endpoint: "https://api.deepseek.com"
  });
}

export async function POST(request: Request) {
  try {
    await requireFamilyRequestContext(request);
    if (!isLiteBackend()) return NextResponse.json({ detail: "这个接口仅用于 Fanmili 本地服务。" }, { status: 404 });
    if (isLocalAuthConfigured() && readLocalSession(request)?.role !== "admin") {
      return NextResponse.json({ detail: "只有家庭管理员可以修改 AI 配置。" }, { status: 403 });
    }
    const body = await request.json().catch(() => ({})) as { apiKey?: unknown; deepModel?: unknown; fastModel?: unknown };
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (!apiKey) return NextResponse.json({ detail: "请填写 DeepSeek API Key。" }, { status: 400 });
    saveLiteAiConfig({
      apiKey,
      deepModel: typeof body.deepModel === "string" ? body.deepModel : "deepseek-v4-pro",
      endpoint: "https://api.deepseek.com",
      fastModel: typeof body.fastModel === "string" ? body.fastModel : "deepseek-v4-flash"
    });
    return NextResponse.json({ configured: true, endpoint: "https://api.deepseek.com" });
  } catch (error) {
    return NextResponse.json({ detail: error instanceof Error ? error.message : "保存 AI 配置失败。" }, { status: 400 });
  }
}
