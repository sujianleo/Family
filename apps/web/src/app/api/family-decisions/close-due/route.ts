import { NextResponse } from "next/server";
import { FamilyRequestContextError, requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { closeDueFamilyDecisions } from "@/lib/server/decisionStore";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const expected = process.env.DECISION_CRON_SECRET;
  try {
    if (expected && request.headers.get("authorization") === `Bearer ${expected}`) {
      const closedIds = await closeDueFamilyDecisions();
      return NextResponse.json({ ok: true, closed_ids: closedIds });
    }
    const context = await requireFamilyRequestContext(request);
    const closedIds = await closeDueFamilyDecisions(new Date(), context.familyId);
    return NextResponse.json({ ok: true, closed_ids: closedIds });
  } catch (error) {
    if (error instanceof FamilyRequestContextError) return NextResponse.json({ detail: error.message }, { status: error.status });
    return NextResponse.json({ detail: error instanceof Error ? error.message : "定时结束失败。" }, { status: 500 });
  }
}
