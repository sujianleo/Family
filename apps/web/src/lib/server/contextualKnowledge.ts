import type { ConversationContext } from "./conversationMemory";

export type ContextualKnowledgeResolution = {
  evidenceText: string;
  subject: string;
  text: string;
};

const relationshipLabels = {
  wife: ["老婆", "媳妇", "媳妇儿", "妻子", "太太", "爱人"],
  husband: ["老公", "丈夫", "先生", "爱人"]
} as const;

/**
 * Resolve only explicit relationship confirmations such as “这是我媳妇儿”.
 * The name must already appear in the assistant's immediately preceding,
 * source-grounded reply. This never invents a person or saves anything.
 */
export function resolveContextualKnowledgeInput(
  text: string,
  conversationContext?: ConversationContext
): ContextualKnowledgeResolution | null {
  const normalized = text.trim().replace(/[。.!！?？]+$/, "");
  const relation = readDeclaredRelationship(normalized);
  if (!relation) return null;

  const name = readRelationshipNameFromRecentTurns(conversationContext, relation.kind);
  if (!name) return null;

  const canonicalRelation = relation.kind === "wife" ? "老婆" : "丈夫";
  return {
    evidenceText: `${text}\n上下文：${name}是你${relation.label}`,
    subject: canonicalRelation,
    text: `${name}是我${canonicalRelation}`
  };
}

function readDeclaredRelationship(text: string) {
  const wife = relationshipLabels.wife.find((label) =>
    new RegExp(`^(?:这|她)(?:个)?(?:人)?(?:就)?是我(?:的)?${label}$`).test(text)
  );
  if (wife) return { kind: "wife" as const, label: wife };

  const husband = relationshipLabels.husband.find((label) =>
    new RegExp(`^(?:这|他)(?:个)?(?:人)?(?:就)?是我(?:的)?${label}$`).test(text)
  );
  return husband ? { kind: "husband" as const, label: husband } : null;
}

function readRelationshipNameFromRecentTurns(
  conversationContext: ConversationContext | undefined,
  kind: "wife" | "husband"
) {
  const aliases = relationshipLabels[kind].join("|");
  const assistantPattern = new RegExp(
    `(?:^|[，,。.!！?？：:\\s])(?:收到|明白|原来|那|所以)?[，,\\s]*(?<name>[\\u4e00-\\u9fff·]{2,6})是你(?:的)?(?:${aliases})(?:$|[，,。.!！?？：:\\s])`
  );
  for (const turn of [...(conversationContext?.activeTurns || [])].reverse()) {
    const matched = normalizeRelationshipName(turn.assistantText.match(assistantPattern)?.groups?.name);
    if (isLikelyPersonName(matched)) return matched;
  }
  return "";
}

function normalizeRelationshipName(value?: string) {
  const normalized = value?.trim() || "";
  return normalized.length > 2 ? normalized.replace(/^(?:那|所以|原来)/, "") : normalized;
}

function isLikelyPersonName(value?: string) {
  if (!value || value.length < 2 || value.length > 6) return false;
  return !/^(?:这是|她是|他是|你的|我的|收到|明白|原来|所以|报告|检查)$/.test(value);
}
