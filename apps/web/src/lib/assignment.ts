import type { AssignmentSuggestion, FamilyMember } from "./types";

const familyMemberAliases: Record<string, string[]> = {
  dad: ["爸爸", "老爸", "父亲", "爸"],
  daughter: ["闺女", "女儿", "姑娘", "孩子", "娃"],
  fanmili: ["小饭大人", "饭米粒", "小范大人", "豆包", "家庭助手", "助手"],
  me: ["小明", "我自己", "本人"],
  mom: ["老妈", "妈妈", "母亲", "妈", "老娘"],
  sister: ["姐姐", "姐"],
  son: ["儿子", "男孩"],
  wife: ["老婆", "媳妇", "媳妇儿", "妻子", "太太", "爱人"]
};

export function suggestAssignment(
  text: string,
  members: FamilyMember[],
  senderMemberId?: string,
  mentionedMemberIds: string[] = []
): AssignmentSuggestion {
  const manuallyMentionedMembers = members.filter((member) => mentionedMemberIds.includes(member.id));

  if (manuallyMentionedMembers.length > 0) {
    return {
      suggestedAssignees: manuallyMentionedMembers.map((member) => toSuggestedAssignee(member)),
      suggestedRoles: [],
      reason: `你手动选择了 ${manuallyMentionedMembers.map((member) => member.displayName).join("、")}`,
      confidence: 0.98
    };
  }

  const explicitMember = resolveFamilyMemberMention(text, members);

  if (explicitMember) {
    return {
      suggestedAssignees: [toSuggestedAssignee(explicitMember)],
      suggestedRoles: [],
      reason: `内容里明确提到了 ${explicitMember.displayName}`,
      confidence: 0.94
    };
  }

  if (isFamilyHelpRequest(text)) {
    const helperMembers = chooseFamilyHelpers(members, senderMemberId);
    if (helperMembers.length > 0) {
      return {
        suggestedAssignees: helperMembers.map((member) => toSuggestedAssignee(member)),
        suggestedRoles: ["家庭支援"],
        reason: "这是家庭内求助，优先建议在线家人帮忙",
        confidence: 0.82
      };
    }
  }

  const currentMember = members.find((member) => member.id === senderMemberId);
  const fallbackMembers = currentMember ? [currentMember] : members.slice(0, 1);

  return {
    suggestedAssignees: fallbackMembers.map((member) => toSuggestedAssignee(member)),
    suggestedRoles: [],
    reason: "没有明确对象，先保留为发起人的任务",
    confidence: 0.55
  };
}

export function roleLabel(role: string) {
  return role;
}

export function resolveFamilyMemberMention(
  text: string,
  members: FamilyMember[],
  options: { includeSelfPronouns?: boolean } = {}
) {
  const normalizedText = text.trim();
  const aliasesByMemberId = new Map(
    members.map((member) => {
      const aliases = [member.displayName, ...(familyMemberAliases[member.id] || [])];
      if (options.includeSelfPronouns && member.id === "me") {
        aliases.push("我");
      }
      return [member.id, uniqueAliases(aliases)] as const;
    })
  );

  const mentionCandidates = members.flatMap((member) =>
    (aliasesByMemberId.get(member.id) || []).map((alias) => ({
      alias,
      member,
      score: scoreAlias(alias, normalizedText)
    }))
  );
  const matchedCandidate = mentionCandidates
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || b.alias.length - a.alias.length)[0];

  return matchedCandidate?.member || null;
}

export function findFamilyMemberMentions(
  text: string,
  members: FamilyMember[],
  options: { includeSelfPronouns?: boolean } = {}
) {
  const mentions = members.flatMap((member) => {
    const aliases = [member.displayName, ...(familyMemberAliases[member.id] || [])];
    if (options.includeSelfPronouns && member.id === "me") aliases.push("我", "我自己");
    return uniqueAliases(aliases).flatMap((alias) => {
      const matches: Array<{ alias: string; end: number; index: number; member: FamilyMember }> = [];
      let fromIndex = 0;
      while (fromIndex < text.length) {
        const index = text.indexOf(alias, fromIndex);
        if (index < 0) break;
        matches.push({ alias, end: index + alias.length, index, member });
        fromIndex = index + alias.length;
      }
      return matches;
    });
  });
  return mentions
    .sort((left, right) => left.index - right.index || right.alias.length - left.alias.length)
    .filter((mention, index, all) =>
      !all.slice(0, index).some((previous) =>
        previous.index === mention.index &&
        previous.end >= mention.end &&
        previous.member.id === mention.member.id
      )
    );
}

function uniqueAliases(aliases: string[]) {
  return Array.from(new Set(aliases.map((alias) => alias.trim()).filter(Boolean)));
}

function scoreAlias(alias: string, text: string) {
  if (text.includes(`@${alias}`)) {
    return 100 + alias.length;
  }
  if (text.includes(alias)) {
    return 10 + alias.length;
  }
  return 0;
}

function isFamilyHelpRequest(text: string) {
  const normalizedText = text.trim();
  return (
    /(我|本人|自己|这边).*(饿了|肚子饿|没吃饭|还没吃|想吃|想喝|渴了|口渴|冷了|热了|不舒服|难受|头晕|发烧|疼|痛)/.test(normalizedText) ||
    /(帮我|给我|需要|麻烦|能不能|可不可以).*(做饭|带饭|点餐|买饭|买菜|买药|倒水|接我|送我|拿一下|取一下|准备吃的|弄点吃的|照看|陪一下)/.test(normalizedText) ||
    /(家里|家庭|有人|谁|有谁).*(可以|能|有空|方便).*(帮忙|做饭|买药|接送|照看|倒水|带饭)/.test(normalizedText)
  );
}

function chooseFamilyHelpers(members: FamilyMember[], senderMemberId?: string) {
  return members
    .filter((member) => member.id !== senderMemberId)
    .filter((member) => member.id !== "fanmili")
    .filter((member) => member.relationshipRole !== "guest")
    .sort((a, b) => scoreHelper(b) - scoreHelper(a))
    .slice(0, 2);
}

function scoreHelper(member: FamilyMember) {
  let score = member.status === "online" ? 10 : 0;
  if (member.relationshipRole === "spouse") {
    score += 4;
  } else if (member.relationshipRole === "parent") {
    score += 3;
  } else if (member.relationshipRole === "relative") {
    score += 2;
  }
  return score;
}

function toSuggestedAssignee(member: FamilyMember) {
  return {
    id: member.id,
    displayName: member.displayName,
    avatarSeed: member.avatarSeed,
    color: member.color
  };
}
