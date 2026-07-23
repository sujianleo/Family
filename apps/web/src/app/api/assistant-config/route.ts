import { NextResponse } from "next/server";
import { DEFAULT_ASSISTANT_NAME } from "@/lib/assistantIdentity";
import { requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { readAssistantPreference } from "@/lib/server/assistantPreferences";
import { readFamilyMembersWithOverrides } from "@/lib/server/memberOverrides";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const [members, preference] = await Promise.all([
      readFamilyMembersWithOverrides("data"),
      readAssistantPreference("data", context.memberId)
    ]);
    return NextResponse.json({
      name: members.find((member) => member.id === "fanmili")?.displayName || DEFAULT_ASSISTANT_NAME,
      personality: preference?.personality || "开朗、务实"
    });
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "读取助手配置失败。" },
      { status: 400 }
    );
  }
}
