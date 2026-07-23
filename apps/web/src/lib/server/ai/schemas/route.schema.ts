import { z } from "zod";

export const routeIntentSchema = z.enum([
  "daily_log",
  "task",
  "reminder",
  "knowledge",
  "app_answer",
  "app_chat",
  "web_search",
  "profile_describe",
  "invite",
  "summary_request",
  "dangerous",
  "ambiguous"
]);

export const assistantRouteModelSchema = z
  .object({
    candidateActions: z.array(z.string().trim().min(1)).max(8),
    confidence: z.number().min(0).max(1),
    entities: z.record(z.unknown()),
    intent: z.array(routeIntentSchema).min(1).max(4)
  })
  .strict();

export type AssistantRouteModelOutput = z.infer<typeof assistantRouteModelSchema>;
