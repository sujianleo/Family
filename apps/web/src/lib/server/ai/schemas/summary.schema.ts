import { z } from "zod";

const sourceIdsSchema = z.array(z.string().trim().min(1));

const summaryMemoryCandidateSchema = z
  .object({
    confidence: z.number().min(0).max(1),
    content: z.string().trim().min(1),
    requiresConfirmation: z.literal(true),
    sourceIds: sourceIdsSchema,
    type: z.enum(["preference", "habit", "family_fact", "repeated_pattern", "rule"])
  })
  .strict();

export const deepSummarySchema = z
  .object({
    familyInteractions: z.array(z.string()),
    foodAndDailyLife: z.array(z.string()),
    healthSignals: z.array(z.string()),
    importantResources: z.array(z.string()),
    mainEvents: z.array(z.string()),
    memberProfileHints: z.array(
      z
        .object({
          hints: z.array(z.string()),
          memberName: z.string().trim().min(1),
          sourceIds: sourceIdsSchema
        })
        .strict()
    ),
    memoryCandidates: z.array(summaryMemoryCandidateSchema),
    moodSignals: z.array(z.string()),
    oneSentenceSummary: z.string().trim().min(1),
    patterns: z.array(z.string()),
    risksOrConcerns: z.array(z.string()),
    sourceIds: sourceIdsSchema,
    suggestions: z.array(z.string()),
    summaryTitle: z.string().trim().min(1),
    taskProgress: z
      .object({
        blocked: z.array(z.string()),
        completed: z.array(z.string()),
        pending: z.array(z.string())
      })
      .strict()
  })
  .strict();

export type DeepSummaryModelOutput = z.infer<typeof deepSummarySchema>;
