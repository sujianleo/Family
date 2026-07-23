import type { BaseMessageLike } from "@langchain/core/messages";
import type { z } from "zod";
import {
  getDeepModelClient,
  getFastModelClient,
  invokeDeepSeekDeepJson,
  invokeDeepSeekJson,
  invokeDeepSeekText,
  type LangChainJsonOptions
} from "../langchainAi";

export type ModelTier = "fast" | "deep";

export type StructuredModelResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      issues?: z.ZodIssue[];
      ok: false;
      reason: "model_unavailable" | "schema_invalid";
    };

export function createFastModel(options: LangChainJsonOptions = {}) {
  return getFastModelClient(options);
}

export function createDeepModel(options: LangChainJsonOptions = {}) {
  return getDeepModelClient(options);
}

export function getDeepModel(options: LangChainJsonOptions = {}) {
  return createDeepModel(options);
}

export async function invokeStructured<T>(
  messages: BaseMessageLike[],
  schema: z.ZodType<T>,
  options: LangChainJsonOptions & { tier?: ModelTier } = {}
): Promise<StructuredModelResult<T>> {
  const { tier = "fast", ...modelOptions } = options;
  let raw: unknown;
  try {
    raw =
      tier === "deep"
        ? await invokeDeepSeekDeepJson(messages, modelOptions)
        : await invokeDeepSeekJson(messages, modelOptions);
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof SyntaxError ? "schema_invalid" : "model_unavailable"
    };
  }

  if (raw === null) {
    return {
      ok: false,
      reason: "model_unavailable"
    };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues,
      ok: false,
      reason: "schema_invalid"
    };
  }

  return {
    ok: true,
    value: parsed.data
  };
}

export function invokeText(messages: BaseMessageLike[], options: LangChainJsonOptions = {}) {
  return invokeDeepSeekText(messages, options);
}
