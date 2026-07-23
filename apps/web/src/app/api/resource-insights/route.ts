import { NextResponse } from "next/server";
import { processResourceInsight } from "@/lib/server/resourceInsights";
import { FamilyRequestContextError, requireFamilyRequestContext } from "@/lib/server/familyRequestContext";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const body = (await request.json()) as {
      actor_member_id?: string;
      actor_name?: string;
      record_id?: string;
      resource_title?: string;
      source_files?: Array<{
        name?: string;
        originalUrl?: string;
        original_url?: string;
        previewUrl?: string;
        preview_url?: string;
        size?: number;
        type?: string;
        url?: string;
      }>;
      space_id?: string;
    };

    const result = await processResourceInsight({
      actorMemberId: readString(body.actor_member_id) || context.memberId,
      actorName: readString(body.actor_name),
      familyId: context.familyId,
      recordId: readString(body.record_id),
      resourceTitle: readString(body.resource_title),
      sourceFiles: Array.isArray(body.source_files)
        ? body.source_files.map((file) => ({
            name: readString(file.name) || "未命名文件",
            originalUrl: readString(file.originalUrl) || readString(file.original_url),
            size: readNumber(file.size),
            type: readString(file.type),
            url: readString(file.url)
          }))
        : [],
      spaceId: readString(body.space_id)
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof FamilyRequestContextError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: error instanceof Error ? error.message : "资料解析失败。" }, { status: 500 });
  }
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
