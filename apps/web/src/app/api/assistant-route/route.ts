import { NextResponse } from "next/server";
import { routeAssistantWithLangChain } from "@/lib/server/assistantChain";
import type { AssistantConversationTurn, AssistantDialogueState } from "@/lib/assistantRouter";
import { FamilyRequestContextError, requireFamilyRequestContext } from "@/lib/server/familyRequestContext";
import { readFamilyMembersForContext } from "@/lib/server/familyMembers";
import { recordRuntimeEvent } from "@/lib/server/runtimeLog";

type AssistantRouteRequest = {
  actor_member_id?: unknown;
  actor_name?: unknown;
  dialogue_state?: unknown;
  recent_conversation?: unknown;
  recent_user_texts?: unknown;
  text?: unknown;
};

export const runtime = "nodejs";

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const context = await requireFamilyRequestContext(request);
    const body = (await request.json()) as AssistantRouteRequest;
    const text = readString(body.text);
    if (!text) {
      return NextResponse.json({ detail: "缺少输入文本。" }, { status: 400 });
    }

    const members = await readFamilyMembersForContext(context);
    const requestedLocalMemberId = readString(body.actor_member_id);
    const actorMemberId =
      context.userId === "local-development" && requestedLocalMemberId ? requestedLocalMemberId : context.memberId;
    const actorName = members.find((member) => member.id === actorMemberId)?.displayName || actorMemberId;
    const route = await routeAssistantWithLangChain(text, members, {
      actorMemberId,
      actorName,
      dialogueState: readDialogueState(body.dialogue_state),
      recentConversation: readConversation(body.recent_conversation),
      recentUserTexts: readStringArray(body.recent_user_texts)
    });
    await recordRuntimeEvent({
      durationMs: Date.now() - startedAt,
      event: "request.completed",
      metadata: {
        routeId: route.kind === "action" || route.kind === "pipeline" ? route.id : route.kind === "automation" ? route.unit.id : route.reason,
        routeKind: route.kind
      },
      source: "api.assistant_route",
      status: "success"
    });
    return NextResponse.json({ route });
  } catch (error) {
    if (error instanceof FamilyRequestContextError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    await recordRuntimeEvent({
      durationMs: Date.now() - startedAt,
      error,
      event: "request.completed",
      source: "api.assistant_route",
      status: "failed"
    });
    return NextResponse.json({ detail: error instanceof Error ? error.message : "输入识别失败。" }, { status: 500 });
  }
}

function readConversation(value: unknown): AssistantConversationTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const turn = item as Record<string, unknown>;
      const role = turn.role === "assistant" || turn.role === "user" ? turn.role : null;
      const text = readString(turn.text);
      return role && text ? { role, text } : null;
    })
    .filter((item): item is AssistantConversationTurn => Boolean(item))
    .slice(-12);
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(-8)
    : [];
}

function readDialogueState(value: unknown): AssistantDialogueState | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const state = value as Record<string, unknown>;
  if (state.activeQueryType !== "records.recent") return undefined;
  const recordDate = readString(state.recordDate);
  const remainingFollowUps =
    typeof state.remainingFollowUps === "number" && Number.isFinite(state.remainingFollowUps)
      ? Math.max(0, Math.min(2, Math.floor(state.remainingFollowUps)))
      : 0;
  if (remainingFollowUps <= 0) return undefined;
  return {
    activeQueryType: "records.recent",
    recordDate: /^\d{4}-\d{2}-\d{2}$/.test(recordDate) ? recordDate : undefined,
    remainingFollowUps
  };
}
