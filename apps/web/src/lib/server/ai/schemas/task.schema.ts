import { z } from "zod";

export const taskExtractSchema = z
  .object({
    confidence: z.number().min(0).max(1),
    display_time: z.string().trim().max(24),
    personal_todo: z.boolean(),
    reason: z.string().trim().min(1),
    suggested_assignee_ids: z.array(z.string().trim().min(1)).min(1),
    suggested_roles: z.array(z.string().trim().min(1)),
    task_action_type: z.enum(["approval", "input", "multiple_choice"]),
    task_options: z.array(z.string().trim().min(1)).max(8),
    task_title: z.string().trim().min(1).max(24)
  })
  .strict()
  .superRefine((value, context) => {
    if (value.task_action_type === "multiple_choice" && value.task_options.length < 2) {
      context.addIssue({
        code: z.ZodIssueCode.too_small,
        inclusive: true,
        minimum: 2,
        path: ["task_options"],
        type: "array"
      });
    }
  });

export type TaskExtractOutput = z.infer<typeof taskExtractSchema>;
