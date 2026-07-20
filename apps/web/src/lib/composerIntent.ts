import { familyRelationshipOptions, normalizeFamilyRelationshipLabel } from "./familyRelationships";

export type ComposerIntent =
  | {
      schemaVersion: "composer.intent.v1";
      action: "create_family_invite";
      confidence: number;
      fields: {
        displayName: string;
        relationshipLabel: string;
      };
      evidence: string[];
      sourceText: string;
    }
  | {
      schemaVersion: "composer.intent.v1";
      action: "create_group_chat";
      confidence: number;
      fields: {
        title: string;
      };
      evidence: string[];
      sourceText: string;
    }
  | {
      schemaVersion: "composer.intent.v1";
      action: "task_suggestion";
      confidence: number;
      fields: Record<string, never>;
      evidence: string[];
      sourceText: string;
    };

const groupCreatePattern = /(创建|新建|建|开|拉)(一个)?(临时)?(群组|群聊|群)/;
const slashGroupPattern = /^(建群|建一个群|新建群|创建群|群聊|群组|group)\b/i;
const titlePatterns = [
  /(?:群聊|群组|群)?(?:的)?(?:名称|名字|群名)\s*(?:就是|是|叫|为|设为|取名为|取名叫)\s*["“]?([^"，,。.！!？?\n]+)["”]?/,
  /(?:叫做|叫|取名为|取名叫|命名为)\s*["“]?([^"，,。.！!？?\n]+)["”]?/
];

export function compileComposerIntent(text: string): ComposerIntent {
  const sourceText = text.trim();
  const normalized = sourceText.replace(/^\/+/, "").trim();
  const evidence: string[] = [];
  const explicitTitle = extractExplicitGroupTitle(sourceText);
  const wantsGroupChat = slashGroupPattern.test(normalized) || groupCreatePattern.test(normalized);

  const familyInvite = extractFamilyInviteFields(normalized);
  if (familyInvite && !/(群聊|群组|进群|加入群)/.test(normalized)) {
    return {
      schemaVersion: "composer.intent.v1",
      action: "create_family_invite",
      confidence: familyInvite.relationshipLabel ? 0.96 : 0.9,
      fields: familyInvite,
      evidence: ["family_invite_keyword", ...(familyInvite.relationshipLabel ? ["relationship_label"] : [])],
      sourceText
    };
  }

  if (slashGroupPattern.test(normalized)) {
    evidence.push("slash_group_command");
  }

  if (groupCreatePattern.test(normalized)) {
    evidence.push("group_create_verb");
  }

  if (explicitTitle) {
    evidence.push("explicit_group_title");
  }

  if (wantsGroupChat) {
    return {
      schemaVersion: "composer.intent.v1",
      action: "create_group_chat",
      confidence: explicitTitle ? 0.94 : 0.78,
      fields: {
        title: explicitTitle || deriveFallbackGroupTitle(sourceText)
      },
      evidence,
      sourceText
    };
  }

  return {
    schemaVersion: "composer.intent.v1",
    action: "task_suggestion",
    confidence: 0.62,
    fields: {},
    evidence,
    sourceText
  };
}

function extractFamilyInviteFields(text: string) {
  const match = text.match(/^(?:请|帮我|麻烦)?\s*邀请(?:一位|一个)?(?:家人|家庭成员|成员)?\s*(.*)$/);
  if (!match) return null;
  const tail = match[1].trim().replace(/[。.!！?？]$/g, "");
  const relationshipLabels = [
    ...familyRelationshipOptions,
    "母亲", "父亲", "妻子", "媳妇", "太太", "丈夫", "先生", "配偶", "闺女", "外婆", "外公"
  ];
  const relationshipLabel = [...relationshipLabels]
    .sort((left, right) => right.length - left.length)
    .find((label) => tail.includes(label)) || "";
  const displayName = tail
    .replace(new RegExp(`^${relationshipLabel || "家人"}`), "")
    .replace(/^(?:叫|名叫|名字叫|姓名是|叫做)\s*/, "")
    .trim()
    .slice(0, 40);
  return { displayName, relationshipLabel: normalizeFamilyRelationshipLabel(relationshipLabel, displayName) };
}

export function buildMentionOnlyGroupMemberIds(currentMemberId: string, mentionedMemberIds: string[]) {
  return [...new Set([currentMemberId, ...mentionedMemberIds].filter(Boolean))];
}

export function haveSameGroupMemberIds(leftMemberIds: string[], rightMemberIds: string[]) {
  const left = new Set(leftMemberIds.filter(Boolean));
  const right = new Set(rightMemberIds.filter(Boolean));
  return left.size === right.size && [...left].every((memberId) => right.has(memberId));
}

export function buildMentionOnlyGroupTitle(memberNames: string[]) {
  return ["我", ...memberNames.filter(Boolean)].join(" ");
}

function extractExplicitGroupTitle(text: string) {
  for (const pattern of titlePatterns) {
    const title = text.match(pattern)?.[1]?.trim();
    if (title) {
      return normalizeTitle(title);
    }
  }

  return "";
}

function deriveFallbackGroupTitle(text: string) {
  const normalized = text
    .trim()
    .replace(/^\/+/, "")
    .replace(/^(帮我|请|麻烦)?(创建|新建|建|开|拉)?(一个)?(临时)?(群组|群聊|群)?(吧|一下|一个)?[，,]*/, "")
    .replace(/[。.!！?？]$/g, "")
    .trim();

  if (!normalized) {
    return "临时群聊邀请";
  }

  if (/群(聊|组)?$/.test(normalized)) {
    return normalizeTitle(normalized);
  }

  return normalizeTitle(`${normalized.slice(0, 14)}群聊`);
}

function normalizeTitle(title: string) {
  return (
    title
      .replace(/^["“'‘]+|["”'’]+$/g, "")
      .replace(/^(做|叫做|叫|名称是|名字是|群名是)+/, "")
      .trim()
      .slice(0, 18) || "临时群聊邀请"
  );
}
