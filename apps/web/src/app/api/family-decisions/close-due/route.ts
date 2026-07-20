import { NextResponse } from "next/server";
import { closeDueFamilyDecisions } from "@/lib/server/decisionStore";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const expected = process.env.DECISION_CRON_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) return NextResponse.json({ detail: "未授权。" }, { status: 401 });
  try { const closedIds = await closeDueFamilyDecisions(); return NextResponse.json({ ok: true, closed_ids: closedIds }); }
  catch (error) { return NextResponse.json({ detail: error instanceof Error ? error.message : "定时结束失败。" }, { status: 500 }); }
}
