import { NextResponse } from "next/server";
import { FamilyRequestContextError, requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { createFamilyDecision, listFamilyDecisions } from "@/lib/server/decisionStore";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const roomRecordId = new URL(request.url).searchParams.get("roomRecordId")?.trim() || "";
    if (!roomRecordId) return NextResponse.json({ detail: "缺少群聊 ID。" }, { status: 400 });
    return NextResponse.json({ decisions: await listFamilyDecisions(context, roomRecordId) });
  }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const body = await request.json() as Record<string, unknown>;
    const decision = await createFamilyDecision(context, {
      roomRecordId: typeof body.roomRecordId === "string" ? body.roomRecordId : "",
      question: typeof body.question === "string" ? body.question : "",
      options: Array.isArray(body.options) ? body.options.filter((item): item is string => typeof item === "string") : [],
      closesAt: typeof body.closes_at === "string" ? body.closes_at : "",
      sourceText: typeof body.source_text === "string" ? body.source_text : ""
    });
    return NextResponse.json({ decision }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

function errorResponse(error: unknown) {
  if (error instanceof FamilyRequestContextError) return NextResponse.json({ detail: error.message }, { status: error.status });
  return NextResponse.json({ detail: error instanceof Error ? error.message : "家庭决定请求失败。" }, { status: 400 });
}
