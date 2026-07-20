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
