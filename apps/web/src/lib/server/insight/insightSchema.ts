import { z } from "zod";

export const insightCapabilitySchema = z.enum([
  "family.insight.daily",
  "family.insight.weekly",
  "family.insight.pattern"
]);

export const insightCandidateTypeSchema = z.enum([
  "family_pattern",
  "member_pattern",
  "task_pattern",
  "relationship_pattern",
  "reminder_candidate",
  "memory_candidate"
]);

const sourceIdsSchema = z.array(z.string().trim().min(1)).min(1).max(24);

export const insightSuggestedActionSchema = z
  .object({
    action: z.literal("create_plan"),
    label: z.literal("创建计划"),
    requiresConfirmation: z.literal(true),
    text: z.string().trim().min(1).max(100)
  })
  .strict();

export const insightCandidateSchema = z
  .object({
    confidence: z.number().min(0).max(1),
    requiresConfirmation: z.boolean(),
    sourceIds: sourceIdsSchema,
    suggestedAction: insightSuggestedActionSchema.nullable(),
    summary: z.string().trim().min(1).max(180),
    title: z.string().trim().min(1).max(48),
    type: insightCandidateTypeSchema
  })
  .strict()
  .superRefine((candidate, context) => {
    if (candidate.type === "memory_candidate" && candidate.requiresConfirmation !== true) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "memory_candidate requires confirmation",
        path: ["requiresConfirmation"]
      });
    }
    if (candidate.suggestedAction && candidate.requiresConfirmation !== true) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "suggested actions require confirmation",
        path: ["requiresConfirmation"]
      });
    }
  });

export const insightBatchSchema = z
  .object({
    insights: z.array(insightCandidateSchema).max(6)
  })
  .strict();

export type InsightBatch = z.infer<typeof insightBatchSchema>;
export type InsightCandidate = z.infer<typeof insightCandidateSchema>;
export type InsightCapability = z.infer<typeof insightCapabilitySchema>;
export type InsightCandidateType = z.infer<typeof insightCandidateTypeSchema>;

export type InsightPresentation = {
  data: {
    capability: InsightCapability;
    insights: InsightCandidate[];
    sourceIds: string[];
  };
  display: {
    dismissible: true;
    target: "inline_assistant";
    type: "summary_card";
  };
  title: "饭米粒今天发现";
  userReply: string;
};
