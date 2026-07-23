import { NextResponse } from "next/server";
import { requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { addDecisionMessage } from "@/lib/server/decisionStore";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireFamilyRequestContext(request); const { id } = await params; const body = await request.json() as Record<string, unknown>;
    const messageType = ["text", "voice", "file", "system"].includes(String(body.message_type)) ? String(body.message_type) as "text" | "voice" | "file" | "system" : "text";
    const message = await addDecisionMessage(context, id, { body: typeof body.body === "string" ? body.body : "", messageType, metadata: typeof body.metadata === "object" && body.metadata ? body.metadata as Record<string, unknown> : {} });
    return NextResponse.json({ message }, { status: 201 });
  } catch (error) { return NextResponse.json({ detail: error instanceof Error ? error.message : "消息发送失败。" }, { status: 400 }); }
}
