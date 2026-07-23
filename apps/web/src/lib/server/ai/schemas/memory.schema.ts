import { z } from "zod";

export const knowledgeCandidateSchema = z
  .object({
    evidenceText: z.string().trim().min(1),
    fact: z.string().trim().min(1),
    memoryType: z.enum(["preference", "habit", "family_fact", "health", "location", "note"]),
    requiresConfirmation: z.literal(true),
    subject: z.string().trim().min(1),
    tags: z.array(z.string().trim().min(1)).max(12)
  })
  .strict();

export type KnowledgeCandidateOutput = z.infer<typeof knowledgeCandidateSchema>;
