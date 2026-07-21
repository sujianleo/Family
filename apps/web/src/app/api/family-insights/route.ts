import { NextResponse } from "next/server";
import { FamilyRequestContextError, requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { runFamilyInsight } from "@/lib/server/insight/insightRunner";
import { insightRange } from "@/lib/server/insight/insightScheduler";
import { insightCapabilitySchema } from "@/lib/server/insight/insightSchema";
import { listStoredInsights } from "@/lib/server/insight/insightService";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") || 7);
    const records = await listStoredInsights(context.familyId, Number.isFinite(limit) ? limit : 7);
    const latest = records[0] || null;
    return NextResponse.json({
      data: {
        capability: latest?.capability || null,
        insights: latest?.batch.insights || [],
        records: records.map(toPublicRecord),
        sourceIds: latest?.sourceIds || []
      },
      display: latest?.presentation.display || {
        dismissible: true,
        target: "inline_assistant",
        type: "summary_card"
      },
      ok: true,
      title: latest?.presentation.title || "饭米粒今天发现",
      userReply: latest?.presentation.userReply || ""
    });
  } catch (error) {
    return insightErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const body = await readBody(request);
    const capabilityResult = insightCapabilitySchema.safeParse(body.capability || "family.insight.daily");
    if (!capabilityResult.success) {
      return NextResponse.json({ detail: "不支持的家庭洞察类型。", ok: false }, { status: 400 });
    }
    const now = new Date();
    const timeZone = readTimeZone(body.timeZone || body.time_zone);
    const range = insightRange(capabilityResult.data, now, timeZone);
    const result = await runFamilyInsight({
      capability: capabilityResult.data,
      endTime: now.toISOString(),
      familyId: context.familyId,
      periodKey: range.periodKey,
      startTime: range.startTime
    });
    const record = "record" in result ? result.record : null;
    const presentation = record?.presentation || ("presentation" in result ? result.presentation : null);
    return NextResponse.json({
      capability: capabilityResult.data,
      data: record ? toPublicRecord(record) : { insights: [], sourceIds: [] },
      display: presentation?.display || {
        dismissible: true,
        target: "inline_assistant",
        type: "summary_card"
      },
      ok: result.ok,
      status: result.skipped ? result.reason || "cached" : "generated",
      title: presentation?.title || "饭米粒今天发现",
      userReply: presentation?.userReply || "饭米粒今天没有发现需要特别提醒的变化。"
    });
  } catch (error) {
    return insightErrorResponse(error);
  }
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function readTimeZone(value: unknown) {
  const candidate = typeof value === "string" && value.trim() ? value.trim() : process.env.FAMILY_APP_TIME_ZONE || "Asia/Shanghai";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return "Asia/Shanghai";
  }
}

function toPublicRecord(record: Awaited<ReturnType<typeof listStoredInsights>>[number]) {
  return {
    capability: record.capability,
    createdAt: record.createdAt,
    id: record.id,
    insights: record.batch.insights,
    model: record.model,
    periodKey: record.periodKey,
    promptVersion: record.promptVersion,
    sourceIds: record.sourceIds
  };
}

function insightErrorResponse(error: unknown) {
  if (error instanceof FamilyRequestContextError) {
    return NextResponse.json({ detail: error.message, ok: false }, { status: error.status });
  }
  return NextResponse.json(
    {
      detail: error instanceof Error ? error.message : "家庭洞察暂时不可用。",
      display: {
        dismissible: true,
        target: "inline_assistant",
        type: "error_card"
      },
      ok: false
    },
    { status: 500 }
  );
}
