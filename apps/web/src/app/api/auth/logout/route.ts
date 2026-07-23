import { NextResponse } from "next/server";
import { allSessionCookieNames } from "@/lib/server/localAuth";

export const runtime = "nodejs";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  for (const name of allSessionCookieNames()) response.cookies.set(name, "", { httpOnly: true, maxAge: 0, path: "/", sameSite: "strict", secure: name.startsWith("__Host-") });
  response.headers.set("cache-control", "no-store");
  return response;
}
