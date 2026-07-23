import { NextResponse } from "next/server";
import { readLiteInstallation } from "@/lib/server/liteRepository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    { backend: "sqlite", setupRequired: !readLiteInstallation() },
    { headers: { "cache-control": "no-store" } }
  );
}
