import { NextResponse } from "next/server";
import { requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { readAssistantPreference, writeAssistantPreference } from "@/lib/server/assistantPreferences";

export const runtime = "nodejs";
const dataDir = "data";

export async function GET(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    return NextResponse.json({ preference: await readAssistantPreference(dataDir, context.memberId) });
  } catch (error) { return NextResponse.json({ detail: error instanceof Error ? error.message : "读取失败。" }, { status: 400 }); }
}

export async function PATCH(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const body = await request.json() as { personality?: unknown };
    const personality = typeof body.personality === "string" ? body.personality : "";
    return NextResponse.json({ preference: await writeAssistantPreference(dataDir, context.memberId, personality) });
  } catch (error) { return NextResponse.json({ detail: error instanceof Error ? error.message : "保存失败。" }, { status: 400 }); }
}
