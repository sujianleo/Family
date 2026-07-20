import { findFamilyMemberMentions, resolveFamilyMemberMention } from "../assignment";
import type { TaskIntent } from "../taskIntent";
import type { FamilyMember } from "../types";

export type CareMemberRoles = {
  notifyMemberIds: string[];
  responsibleMemberIds: string[];
  subjectMemberIds: string[];
};

export function resolveCareMemberRoles(input: {
  actorMemberId?: string;
  inheritedSubjectMemberIds?: string[];
  intent: TaskIntent;
  members: FamilyMember[];
  text: string;
}): CareMemberRoles {
  const concreteMentionIds = [
    ...new Set(
      findFamilyMemberMentions(input.text, input.members)
        .filter((mention) => !["孩子", "娃"].includes(mention.alias))
        .map((mention) => mention.member.id)
    )
  ];
  const clauses = input.text
    .split(/[，,。；;！？!?\n]+/)
    .map((clause) => clause.trim())
    .filter(Boolean);
  const hasResolvableCarePronoun = clauses.some((clause, index) => {
    if (!/(?:他|她|其)/.test(clause)) return false;
    const priorText = clauses.slice(0, index).join("，");
    if (!priorText) return false;
    const priorMentions = findFamilyMemberMentions(priorText, input.members);
    const priorCareSubjects = priorMentions.filter((mention) => {
      const followingText = priorText.slice(mention.end);
      return /^(?:.{0,24})(?:复查|复诊|复测|体检|医院|吃药|用药|血压|血糖|心率|体温|不舒服|疼|痛|发烧|咳嗽|检查结果|检查报告)/.test(
        followingText
      );
    });
    return new Set(priorCareSubjects.map((mention) => mention.member.id)).size === 1;
  });
  const unresolvedPronoun =
    /(?:他|她|孩子|找个人|有人)/.test(input.text) &&
    !hasResolvableCarePronoun &&
    concreteMentionIds.length !== 1 &&
    (input.inheritedSubjectMemberIds || []).length !== 1;
  const ambiguousMember =
    unresolvedPronoun ||
    /(?:谁负责|负责人.{0,8}(?:待确认|没定|未定|确认前)|负责.{0,8}(?:人|成员).{0,6}(?:没定|未定|待确认)|具体谁.{0,8}(?:没说|不清楚|未定))/.test(input.text);
  const subjectScores = new Map<string, number>();
  const responsibleScores = new Map<string, number>();
  const excludedMemberIds = new Set<string>();

  for (const clause of clauses) {
    const mentions = mentionsForClause(clause, input.members, input.actorMemberId);
    if (/(?:不用|不要|别|无需|不负责|只旁听|只看结果)/.test(clause)) {
      for (const mention of mentions) excludedMemberIds.add(mention.member.id);
    }
    const healthCueIndex = clause.search(/复查|复诊|复测|体检|医院|吃药|用药|血压|血糖|心率|体温|不舒服|疼|痛|发烧|咳嗽|检查结果|检查报告/);
    let clauseSubjectMemberId = "";
    if (healthCueIndex >= 0) {
      const subject = nearestMention(mentions, healthCueIndex, "before") || nearestMention(mentions, healthCueIndex, "after");
      if (subject) {
        clauseSubjectMemberId = subject.member.id;
        addScore(subjectScores, subject.member.id, 10);
      }
    }

    for (const cue of findCueIndexes(clause, /负责|处理|开车|接送|陪同|陪着|陪|带着|带|照顾|提醒|督促|联系|确认/g)) {
      const before = nearestMention(mentions, cue, "before", 24);
      const after = nearestMention(mentions, cue, "after", 10);
      const responsible =
        before && before.member.id !== clauseSubjectMemberId
          ? before
          : after || before;
      if (responsible) addScore(responsibleScores, responsible.member.id, 10);
    }

    if (/(?:让|叫|交给|由|安排|派给|给).{0,16}(?:任务|提醒|负责|处理|创建)/.test(clause)) {
      const assigned = resolveFamilyMemberMention(clause.replace(/^.*?(?:让|叫|交给|由|安排|派给|给)/, ""), input.members);
      if (assigned) addScore(responsibleScores, assigned.id, 12);
    }
  }

  const correctedText = input.text.split(/(?:改成|应该是|不是[^，,。；;]*[，,。；;]\s*是)/).at(-1) || "";
  if (correctedText && correctedText !== input.text) {
    const correctedMember = resolveFamilyMemberMention(correctedText, input.members);
    if (correctedMember) addScore(responsibleScores, correctedMember.id, 30);
  }

  for (const memberId of excludedMemberIds) responsibleScores.delete(memberId);
  let subjectMemberIds = rankedIds(subjectScores, 1);
  let responsibleMemberIds = rankedIds(responsibleScores, 1);
  if (
    (input.inheritedSubjectMemberIds || []).length > 0 &&
    /(?:他|她|其).{0,16}(?:复查|复测|吃药|检查|测)|(?:陪|提醒)(?:他|她)/.test(input.text)
  ) {
    subjectMemberIds = (input.inheritedSubjectMemberIds || []).slice(0, 1);
  }
  if (!subjectMemberIds.length && input.intent.taskKind === "health_followup" && /\b我\b|提醒我|我自己/.test(input.text) && input.actorMemberId) {
    subjectMemberIds = [input.actorMemberId];
  }
  if (/(?:患者|被照顾的人|复查的人).{0,8}(?:是谁|未确认|没确认|不清楚)/.test(input.text)) {
    subjectMemberIds = [];
  }
  subjectMemberIds = subjectMemberIds.filter((memberId) => !excludedMemberIds.has(memberId) || /(?:检查|复查|复诊|体检|血压|血糖)/.test(input.text));
  if (ambiguousMember) {
    responsibleMemberIds = [];
  } else if (!responsibleMemberIds.length && /(?:他|她)/.test(input.text) && concreteMentionIds.length === 1) {
    responsibleMemberIds = [concreteMentionIds[0]];
  } else if (!responsibleMemberIds.length && input.intent.assigneeScope === "mentioned") {
    const mentioned = resolveFamilyMemberMention(input.intent.sourceText, input.members);
    responsibleMemberIds = mentioned ? [mentioned.id] : [];
  } else if (!responsibleMemberIds.length && input.intent.taskKind === "health_followup" && subjectMemberIds.length) {
    responsibleMemberIds = [subjectMemberIds[0]];
  } else if (
    !responsibleMemberIds.length &&
    input.actorMemberId &&
    input.intent.taskKind !== "family_help" &&
    input.intent.taskKind !== "open_volunteer"
  ) {
    responsibleMemberIds = [input.actorMemberId];
  }

  return {
    notifyMemberIds: responsibleMemberIds,
    responsibleMemberIds,
    subjectMemberIds
  };
}

function mentionsForClause(clause: string, members: FamilyMember[], actorMemberId?: string) {
  const mentions = findFamilyMemberMentions(clause, members);
  const actor = actorMemberId ? members.find((member) => member.id === actorMemberId) : undefined;
  if (!actor) return mentions;
  for (const match of clause.matchAll(/我自己|我/g)) {
    const index = match.index || 0;
    mentions.push({
      alias: match[0],
      end: index + match[0].length,
      index,
      member: actor
    });
  }
  return mentions.sort((left, right) => left.index - right.index || right.alias.length - left.alias.length);
}

function nearestMention(
  mentions: ReturnType<typeof findFamilyMemberMentions>,
  cueIndex: number,
  direction: "after" | "before",
  maxDistance = Number.POSITIVE_INFINITY
) {
  const candidates = mentions
    .map((mention) => ({
      mention,
      distance: direction === "before" ? cueIndex - mention.end : mention.index - cueIndex
    }))
    .filter(({ distance }) => distance >= 0 && distance <= maxDistance)
    .sort((left, right) => left.distance - right.distance);
  return candidates[0]?.mention;
}

function findCueIndexes(text: string, pattern: RegExp) {
  return [...text.matchAll(pattern)].map((match) => match.index || 0);
}

function addScore(scores: Map<string, number>, memberId: string, score: number) {
  scores.set(memberId, (scores.get(memberId) || 0) + score);
}

function rankedIds(scores: Map<string, number>, limit: number) {
  return [...scores.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([memberId]) => memberId)
    .slice(0, limit);
}
