import { NextResponse } from "next/server";
import { isLocalAuthConfigured, readLocalSession } from "@/lib/server/localAuth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = isLocalAuthConfigured() ? readLocalSession(request) : null;
  return NextResponse.json(
    { authenticated: Boolean(session), memberId: session?.memberId || null, role: session?.role || null },
    { headers: { "cache-control": "no-store" }, status: session ? 200 : 401 }
  );
}
