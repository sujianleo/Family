import { invokeStructured } from "../models";
import { buildTaskExtractMessages, type TaskExtractInput } from "../prompts/task-extract-v1";
import { taskExtractSchema, type TaskExtractOutput } from "../schemas/task.schema";

export async function invokeTaskExtractChain(
  input: TaskExtractInput,
  options: {
    dataDir?: string;
    familyId?: string | null;
    timeoutMs?: number;
  } = {}
): Promise<TaskExtractOutput | null> {
  const result = await invokeStructured(buildTaskExtractMessages(input), taskExtractSchema, {
    ...options,
    maxTokens: 360,
    operation: "task.extract",
    temperature: 0.2,
    tier: "fast"
  });
  return result.ok ? result.value : null;
}
