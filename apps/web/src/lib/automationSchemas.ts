import { z } from "zod";
import type { AutomationActionId } from "./automationRegistry";

const looseJsonSchema: z.ZodType<unknown> = z.unknown();
const textSchema = z.string().trim().optional();

const baseInputSchema = z
  .object({
    session_id: textSchema,
    text: textSchema
  })
  .passthrough();

const baseOutputSchema = z
  .object({
    actionId: z.string(),
    result: looseJsonSchema.optional(),
    status: z.string()
  })
  .passthrough();

export type AutomationActionSchemaDefinition = {
  input: z.ZodType<unknown>;
  output: z.ZodType<unknown>;
};

export const automationActionSchemas: Record<AutomationActionId, AutomationActionSchemaDefinition> = {
  "app.answer": {
    input: baseInputSchema.extend({
      record_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      query_type: z
        .enum(["system.time", "system.date", "members.count", "members.list", "members.online", "profiles.available", "tasks.outgoing", "tasks.incoming", "tasks.pending", "tasks.help", "resources.list", "records.recent", "api.usage", "app.capabilities", "unknown"])
        .optional()
    }),
    output: baseOutputSchema
  },
  "app.chat": {
    input: baseInputSchema,
    output: baseOutputSchema
  },
  "app.runtime.inspect": {
    input: baseInputSchema.extend({
      component: textSchema,
      error_type: z.enum(["authentication", "invalid_response", "network", "push", "rate_limited", "storage", "timeout", "unknown"]).optional(),
      hours: z.number().int().min(1).max(720).optional(),
      level: z.enum(["info", "warn", "error"]).optional(),
      limit: z.number().int().min(1).max(20).optional()
    }),
    output: baseOutputSchema
  },
  "assistant.suggest.next": {
    input: baseInputSchema,
    output: baseOutputSchema
  },
  "scheduler.job.create": {
    input: baseInputSchema.extend({
      action_id: textSchema,
      run_at: textSchema,
      target_parameters: z.record(z.string(), z.unknown()).optional()
    }),
    output: baseOutputSchema
  },
  "scheduler.job.cancel": {
    input: baseInputSchema.extend({
      job_id: textSchema
    }),
    output: baseOutputSchema
  },
  "member.rename": {
    input: baseInputSchema.extend({
      member: textSchema,
      new_name: textSchema
    }),
    output: baseOutputSchema
  },
  "member.knowledge.resolve": {
    input: baseInputSchema.extend({
      member: textSchema,
      member_id: textSchema
    }),
    output: baseOutputSchema
  },
  "member.knowledge.ask": {
    input: baseInputSchema.extend({ inquiry_id: textSchema }),
    output: baseOutputSchema
  },
  "member.knowledge.provide_input": {
    input: baseInputSchema.extend({ inquiry_id: textSchema }),
    output: baseOutputSchema
  },
  "member.knowledge.dismiss": {
    input: baseInputSchema.extend({ inquiry_id: textSchema }),
    output: baseOutputSchema
  },
  "member.knowledge.collect_reply": {
    input: baseInputSchema.extend({ inquiry_id: textSchema }),
    output: baseOutputSchema
  },
  "member.knowledge.followup": {
    input: baseInputSchema.extend({ inquiry_id: textSchema }),
    output: baseOutputSchema
  },
  "invite.create": {
    input: baseInputSchema.extend({
      member: textSchema
    }),
    output: baseOutputSchema
  },
  "invite.accept": {
    input: baseInputSchema.extend({ code: textSchema, display_name: textSchema, invite_id: textSchema }),
    output: baseOutputSchema
  },
  "invite.revoke": {
    input: baseInputSchema.extend({ invite_id: textSchema }),
    output: baseOutputSchema
  },
  "safety.dangerous_operation": {
    input: baseInputSchema,
    output: baseOutputSchema
  },
  "profile.avatar": {
    input: z.object({}).passthrough(),
    output: baseOutputSchema
  },
  "profile.describe": {
    input: baseInputSchema.extend({
      member: textSchema
    }),
    output: baseOutputSchema
  },
  "group.create": {
    input: baseInputSchema.extend({
      title: textSchema
    }),
    output: baseOutputSchema
  },
  "group.organize.contextual": {
    input: baseInputSchema,
    output: baseOutputSchema
  },
  "group.ask.family": {
    input: baseInputSchema,
    output: baseOutputSchema
  },
  "group.message.send": {
    input: baseInputSchema.extend({
      room_id: textSchema
    }),
    output: baseOutputSchema
  },
  "decision.create.quick": {
    input: baseInputSchema,
    output: baseOutputSchema
  },
  "judgement.create": {
    input: baseInputSchema,
    output: baseOutputSchema
  },
  "record.organize": {
    input: baseInputSchema,
    output: baseOutputSchema
  },
  "resource.organize": {
    input: baseInputSchema,
    output: baseOutputSchema
  },
  "resource.assign_owner": {
    input: baseInputSchema.extend({
      owner_member_id: textSchema,
      owner_name: textSchema,
      record_id: z.string().trim().min(1),
      resource_title: textSchema
    }),
    output: baseOutputSchema
  },
  "rag.query.family": {
    input: baseInputSchema,
    output: baseOutputSchema
  },
  "rag.query.resources": {
    input: baseInputSchema,
    output: baseOutputSchema
  },
  "rag.query.memory": {
    input: baseInputSchema,
    output: baseOutputSchema
  },
  "task.create.approval": {
    input: baseInputSchema.extend({
      assignee_member_ids: z.array(z.string().trim()).optional(),
      display_time: textSchema,
      due_at: textSchema,
      personal_todo: z.boolean().optional(),
      source_ids: z.array(z.string().trim()).optional(),
      title: textSchema
    }),
    output: baseOutputSchema
  },
  "task.create.input": {
    input: baseInputSchema.extend({
      assignee_member_ids: z.array(z.string().trim()).optional(),
      display_time: textSchema,
      due_at: textSchema,
      personal_todo: z.boolean().optional(),
      source_ids: z.array(z.string().trim()).optional(),
      title: textSchema
    }),
    output: baseOutputSchema
  },
  "task.create.multiple_choice": {
    input: baseInputSchema.extend({
      assignee_member_ids: z.array(z.string().trim()).optional(),
      display_time: textSchema,
      due_at: textSchema,
      options: z.union([z.string(), z.array(z.string())]).optional(),
      personal_todo: z.boolean().optional(),
      source_ids: z.array(z.string().trim()).optional(),
      title: textSchema
    }),
    output: baseOutputSchema
  },
  "web.search.duckduckgo": {
    input: baseInputSchema.extend({
      max_results: z.number().int().positive().max(10).optional(),
      query: textSchema
    }),
    output: baseOutputSchema
  },
  "summary.personal.daily": {
    input: baseInputSchema.extend({
      actor_member_id: textSchema,
      end_time: textSchema,
      family_id: textSchema,
      start_time: textSchema
    }),
    output: baseOutputSchema
  },
  "summary.personal.weekly": {
    input: baseInputSchema.extend({
      actor_member_id: textSchema,
      end_time: textSchema,
      family_id: textSchema,
      start_time: textSchema
    }),
    output: baseOutputSchema
  },
  "summary.family.daily": {
    input: baseInputSchema.extend({
      end_time: textSchema,
      family_id: textSchema,
      start_time: textSchema
    }),
    output: baseOutputSchema
  },
  "summary.family.weekly": {
    input: baseInputSchema.extend({
      end_time: textSchema,
      family_id: textSchema,
      start_time: textSchema
    }),
    output: baseOutputSchema
  },
  "summary.family.monthly": {
    input: baseInputSchema.extend({
      end_time: textSchema,
      family_id: textSchema,
      start_time: textSchema
    }),
    output: baseOutputSchema
  },
  "summary.family.yearly": {
    input: baseInputSchema.extend({
      end_time: textSchema,
      family_id: textSchema,
      start_time: textSchema
    }),
    output: baseOutputSchema
  },
  "memory.extract.family": {
    input: baseInputSchema.extend({
      end_time: textSchema,
      family_id: textSchema,
      start_time: textSchema
    }),
    output: baseOutputSchema
  },
  "memory.save": {
    input: baseInputSchema.extend({
      evidence_text: textSchema,
      fact: textSchema,
      memory_type: z.enum(["preference", "habit", "family_fact", "health", "location", "note"]).optional(),
      source_raw_event_id: textSchema,
      source_ids: z.array(z.string().trim()).optional(),
      subject: textSchema,
      tags: z.array(z.string().trim()).optional()
    }),
    output: baseOutputSchema
  },
  "profile.refresh.deep": {
    input: baseInputSchema.extend({
      end_time: textSchema,
      family_id: textSchema,
      start_time: textSchema
    }),
    output: baseOutputSchema
  },
  "background.organize.daily": {
    input: baseInputSchema.extend({
      end_time: textSchema,
      force: z.boolean().optional(),
      start_time: textSchema,
      time_zone: textSchema
    }),
    output: baseOutputSchema
  },
  "meta.summary.daily": {
    input: baseInputSchema,
    output: baseOutputSchema
  },
  "meta.summary.weekly": {
    input: baseInputSchema,
    output: baseOutputSchema
  },
  "meta.summary.monthly": {
    input: baseInputSchema,
    output: baseOutputSchema
  },
  "meta.profiles.refresh": {
    input: baseInputSchema,
    output: baseOutputSchema
  }
};

export function getAutomationActionSchemas() {
  return automationActionSchemas;
}

export function parseAutomationActionInput(actionId: AutomationActionId, parameters: Record<string, unknown>) {
  return automationActionSchemas[actionId].input.parse(parameters) as Record<string, unknown>;
}

export function parseAutomationActionOutput(actionId: AutomationActionId, output: unknown) {
  return automationActionSchemas[actionId].output.parse(output);
}
