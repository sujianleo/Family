import { NextResponse } from "next/server";
import { FamilyRequestContextError, requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { readKnowledgeInquiries } from "@/lib/server/knowledgeInquiryStore";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const url = new URL(request.url);
    const after = readIsoDate(url.searchParams.get("after"));
    const inquiries = (await readKnowledgeInquiries("data", context.familyId))
      .filter((item) => item.requesterMemberId === context.memberId || item.targetMemberId === context.memberId)
      .filter((item) => !after || item.updatedAt > after)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 50);
    return NextResponse.json({
      inquiries,
      nextCursor: inquiries.reduce((latest, item) => item.updatedAt > latest ? item.updatedAt : latest, after || ""),
      serverTime: new Date().toISOString()
    });
  } catch (error) {
    if (error instanceof FamilyRequestContextError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: error instanceof Error ? error.message : "无法同步信息核实流程。" }, { status: 500 });
  }
}

function readIsoDate(value: string | null) {
  const normalized = value?.trim() || "";
  return normalized && Number.isFinite(new Date(normalized).getTime()) ? new Date(normalized).toISOString() : "";
}
