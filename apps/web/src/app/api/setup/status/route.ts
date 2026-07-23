import { NextResponse } from "next/server";
import { isLiteBackend } from "@/lib/server/familyBackend";
import { readLiteInstallation } from "@/lib/server/liteRepository";
import { createServiceSupabaseClient } from "@/lib/server/supabaseServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (isLiteBackend()) {
    return NextResponse.json(
      { backend: "sqlite", setupRequired: !readLiteInstallation() },
      { headers: { "cache-control": "no-store" } }
    );
  }
  const service = createServiceSupabaseClient();
  if (!service) {
    return NextResponse.json({ detail: "本地 Supabase 尚未连接。" }, { status: 503 });
  }

  const { data, error } = await service.from("app_installation").select("id").eq("id", 1).maybeSingle();
  if (error) {
    return NextResponse.json({ detail: "数据库尚未初始化，请运行本地部署脚本。" }, { status: 503 });
  }

  return NextResponse.json(
    { setupRequired: !data },
    { headers: { "cache-control": "no-store" } }
  );
}
