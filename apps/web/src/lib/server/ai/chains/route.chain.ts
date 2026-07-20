import type { ValidateAssistantRouteCandidateResult } from "../../../assistantRouter";
import { validateAssistantRouteCandidate } from "../../../assistantRouter";
import { invokeStructured } from "../models";
import { buildRouteIntentMessages, type RouterInput } from "../prompts/route-intent-v1";
import { assistantRouteModelSchema } from "../schemas/route.schema";

export async function invokeRouteChain(
  input: RouterInput,
  context: {
    availableUnits: unknown[];
    deterministicHint: unknown;
    toolNames: string[];
  },
  options: {
    dataDir?: string;
    familyId?: string | null;
    maxTokens?: number;
    timeoutMs?: number;
  } = {}
): Promise<ValidateAssistantRouteCandidateResult> {
  const result = await invokeStructured(
    buildRouteIntentMessages(input, context),
    assistantRouteModelSchema,
    {
      ...options,
      operation: "assistant.route",
      temperature: 0.1,
      tier: "fast"
    }
  );

  if (!result.ok) {
    return validateAssistantRouteCandidate(null, {
      fallbackDisplayTarget: "inline_assistant",
      fallbackDisplayType: "chat_reply"
    });
  }

  return validateAssistantRouteCandidate(result.value, {
    fallbackDisplayTarget: "inline_assistant",
    fallbackDisplayType: "chat_reply"
  });
}
