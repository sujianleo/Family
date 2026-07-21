import type { BaseMessageLike } from "@langchain/core/messages";
import type { AutomationActionDefinition } from "../../../automationRegistry";
import { buildRouteIntentPrompt } from "../../../assistantRouter";
import type { FamilyMember } from "../../../types";

export type RouterInput = {
  actor: {
    displayName: string;
    memberId: string;
  };
  candidateActions: AutomationActionDefinition[];
  composerContext?: {
    decisionId?: string;
    groupId?: string;
    memberId?: string;
    taskId?: string;
  };
  currentDate: string;
  familyMembers: FamilyMember[];
  recentContext: string[];
  userInput: string;
};

export function buildRouteIntentMessages(
  input: RouterInput,
  context: {
    availableUnits: unknown[];
    deterministicHint: unknown;
    toolNames: string[];
  }
): BaseMessageLike[] {
  return [
    {
      role: "system",
      content: buildRouteIntentPrompt({
        actorName: input.actor.displayName,
        candidateActions: input.candidateActions,
        currentDate: input.currentDate,
        familyMembers: input.familyMembers,
        recentContext: input.recentContext.join("\n") || "无",
        userInput: input.userInput
      })
    },
    {
      role: "user",
      content: JSON.stringify({
        available_units: context.availableUnits,
        composer_context: input.composerContext || {},
        deterministic_hint: context.deterministicHint,
        members: input.familyMembers.map((member) => ({
          displayName: member.displayName,
          id: member.id,
          relationshipRole: member.relationshipRole
        })),
        recent_user_texts: input.recentContext.slice(-8),
        text: input.userInput,
        tool_names: context.toolNames
      })
    }
  ];
}

export function buildRouteReflectionMessages(
  input: RouterInput,
  context: {
    availableUnits: unknown[];
    concern: string;
    deterministicHint: unknown;
    initialCandidate: unknown;
    toolNames: string[];
  }
): BaseMessageLike[] {
  return [
    {
      role: "system",
      content: `${buildRouteIntentPrompt({
        actorName: input.actor.displayName,
        candidateActions: input.candidateActions,
        currentDate: input.currentDate,
        familyMembers: input.familyMembers,
        recentContext: input.recentContext.join("\n") || "无",
        userInput: input.userInput
      })}\n\n这是一次且仅一次的路由复核。重新阅读原始输入和上下文，检查第一次候选是否误把普通聊天或只读请求变成了写操作。只能返回一个最合适的 candidateAction；无法确定时使用 ambiguous。不要执行任何动作。`
    },
    {
      role: "user",
      content: JSON.stringify({
        available_units: context.availableUnits,
        concern: context.concern,
        deterministic_hint: context.deterministicHint,
        first_candidate: context.initialCandidate,
        members: input.familyMembers.map((member) => ({
          displayName: member.displayName,
          id: member.id,
          relationshipRole: member.relationshipRole
        })),
        recent_context: input.recentContext.slice(-12),
        text: input.userInput,
        tool_names: context.toolNames
      })
    }
  ];
}
