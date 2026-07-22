export type ComposerMentionEdit = {
  caret: number;
  value: string;
};

export function insertComposerMention(value: string, displayName: string, cursor = value.length): ComposerMentionEdit {
  const safeCursor = Math.max(0, Math.min(value.length, cursor));
  const beforeCursor = value.slice(0, safeCursor);
  const trigger = beforeCursor.match(/@[^@\s，,。.!！?？；;：:]*$/);
  const mention = `@${displayName.trim()}`;
  if (trigger?.index !== undefined) {
    const start = trigger.index;
    const suffix = value.slice(safeCursor);
    const separator = needsMentionSeparator(suffix) ? " " : "";
    return {
      caret: start + mention.length + separator.length,
      value: `${value.slice(0, start)}${mention}${separator}${suffix}`
    };
  }
  const suffix = value.slice(safeCursor);
  const separator = needsMentionSeparator(suffix) ? " " : "";
  return {
    caret: safeCursor + mention.length + separator.length,
    value: `${value.slice(0, safeCursor)}${mention}${separator}${suffix}`
  };
}

export function hasComposerMentionTrigger(value: string) {
  return /@[^@\s，,。.!！?？；;：:]*$/.test(value);
}

export function isComposerMentionTriggerAtStart(value: string, cursor = value.length) {
  const beforeCursor = value.slice(0, Math.max(0, Math.min(value.length, cursor)));
  const trigger = beforeCursor.match(/@[^@\s，,。.!！?？；;：:]*$/);
  return trigger?.index !== undefined && beforeCursor.slice(0, trigger.index).trim().length === 0;
}

export function clearComposerMentionTrigger(value: string, cursor = value.length): ComposerMentionEdit {
  const safeCursor = Math.max(0, Math.min(value.length, cursor));
  const beforeCursor = value.slice(0, safeCursor);
  const trigger = beforeCursor.match(/@[^@\s，,。.!！?？；;：:]*$/);
  if (trigger?.index === undefined) return { caret: safeCursor, value };
  return {
    caret: trigger.index,
    value: `${value.slice(0, trigger.index)}${value.slice(safeCursor)}`
  };
}

export function withSelectedMentionLabels(text: string, displayNames: string[]) {
  const missingMentions = displayNames
    .map((name) => `@${name.trim()}`)
    .filter((mention) => mention.length > 1 && !text.includes(mention));
  return missingMentions.length ? `${missingMentions.join(" ")} ${text}`.trim() : text;
}

export function mentionLabelsForPlainDisplay(value: string) {
  return value.replace(/(^|[\s、，,])@(?=[^\s、，,]+)/g, "$1");
}

export function removeComposerMention(value: string, displayName: string): ComposerMentionEdit {
  const mention = `@${displayName.trim()}`;
  const index = value.indexOf(mention);
  if (index < 0) return { caret: value.length, value };
  const nextValue = `${value.slice(0, index)}${value.slice(index + mention.length)}`;
  return {
    caret: index,
    value: nextValue
  };
}

function needsMentionSeparator(suffix: string) {
  return suffix.length === 0 || !/^[\s，,。.!！?？；;：:]/.test(suffix);
}
