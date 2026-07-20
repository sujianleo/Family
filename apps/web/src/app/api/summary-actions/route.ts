import { NextResponse } from "next/server";
import { DEEP_SUMMARY_PROMPT_VERSION, generateDeepSummary } from "@/lib/server/deepSummary";
import { createAutomationRun, createRawEvent } from "@/lib/server/eventStore";
import { getDeepModelName } from "@/lib/server/langchainAi";
import type { SummaryScope, SummaryType } from "@/lib/server/summarySourceBuilder";
import { FamilyRequestContextError, requireFamilyRequestContext } from "@/lib/server/familyRequestContext";

type SummaryActionRequest = {
  actorMemberId?: unknown;
  actor_member_id?: unknown;
  endTime?: unknown;
  end_time?: unknown;
  familyId?: unknown;
  family_id?: unknown;
  scope?: unknown;
  startTime?: unknown;
  start_time?: unknown;
  summaryType?: unknown;
  summary_type?: unknown;
};

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const context = await requireFamilyRequestContext(request);
    const body = (await request.json()) as SummaryActionRequest;
    const input = {
      actorMemberId: context.memberId || null,
      endTime: readString(body.endTime) || readString(body.end_time),
      familyId: context.familyId,
      scope: readScope(body.scope),
      startTime: readString(body.startTime) || readString(body.start_time),
      summaryType: readSummaryType(body.summaryType || body.summary_type)
    };

    if (!input.familyId || !input.startTime || !input.endTime) {
      return NextResponse.json({ detail: "familyId、startTime、endTime 必填。" }, { status: 400 });
    }

    const actionId = resolveSummaryActionId(input.scope, input.summaryType);
    const startedAt = new Date().toISOString();
    const rawEvent = await createRawEvent({
      actorMemberId: input.actorMemberId,
      familyId: input.familyId,
      rawPayload: {
        action_id: actionId,
        parameters: input
      },
      rawText: actionId,
      serverMetadata: {
        entrypoint: "/api/summary-actions"
      },
      sourceType: "automation.action_request"
    });

    try {
      const result = await generateDeepSummary(input);
      await createAutomationRun({
        actionId,
        familyId: input.familyId,
        input,
        modelName: getDeepModelName(),
        output: {
          summaryId: result.summaryId,
          summary: result.summary
        },
        promptVersion: DEEP_SUMMARY_PROMPT_VERSION,
        rawEventId: rawEvent.id,
        requiresConfirmation: false,
        sideEffectLevel: "low",
        startedAt,
        status: "success"
      });
      return NextResponse.json({
        ok: true,
        summaryId: result.summaryId,
        display: result.display,
        summary: {
          mainEvents: result.summary.summaryJson.mainEvents,
          memoryCandidates: result.summary.summaryJson.memoryCandidates,
          oneSentenceSummary: result.summary.summaryJson.oneSentenceSummary,
          suggestions: result.summary.summaryJson.suggestions,
          title: result.summary.summaryJson.summaryTitle
        }
      });
    } catch (error) {
      await createAutomationRun({
        actionId,
        errorMessage: error instanceof Error ? error.message : "深度总结失败。",
        familyId: input.familyId,
        input,
        modelName: getDeepModelName(),
        promptVersion: DEEP_SUMMARY_PROMPT_VERSION,
        rawEventId: rawEvent.id,
        requiresConfirmation: false,
        sideEffectLevel: "low",
        startedAt,
        status: "failed"
      });
      throw error;
    }
  } catch (error) {
    if (error instanceof FamilyRequestContextError) {
      return NextResponse.json({ detail: error.message, ok: false }, { status: error.status });
    }
    return NextResponse.json(
      {
        detail: error instanceof Error ? error.message : "深度总结失败。",
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
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readScope(value: unknown): SummaryScope {
  return value === "family" ? "family" : "personal";
}

function readSummaryType(value: unknown): SummaryType {
  return value === "weekly" || value === "monthly" || value === "custom" ? value : "daily";
}

function resolveSummaryActionId(scope: SummaryScope, summaryType: SummaryType) {
  if (scope === "personal") {
    return summaryType === "weekly" ? "summary.personal.weekly" : "summary.personal.daily";
  }
  if (summaryType === "monthly") {
    return "summary.family.monthly";
  }
  return summaryType === "weekly" ? "summary.family.weekly" : "summary.family.daily";
}
