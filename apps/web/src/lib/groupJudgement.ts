export type JudgementStance = "left" | "right" | "neutral" | "undecided";
export type JudgementStanceSource = "manual" | "ai_suggested" | "ai_confirmed";
export type GroupJudgementStatus = "active" | "closed" | "cancelled";
export type GroupJudgementCloseReason = "creator" | "deadline";
export type GroupJudgementResolution = "left" | "right";

export type GroupJudgementStance = {
  confidence?: number;
  evidenceMessageId?: string;
  evidenceText?: string;
  memberId: string;
  source: JudgementStanceSource;
  stance: JudgementStance;
  updatedAt: string;
};

export type GroupJudgement = {
  closeReason?: GroupJudgementCloseReason;
  closedAt?: string;
  createdAt: string;
  creatorMemberId: string;
  endsAt?: string;
  familyId: string;
  id: string;
  leftLabel: string;
  leftMemberId?: string;
  neutralSummary?: string;
  rightLabel: string;
  rightMemberId?: string;
  roomRecordId: string;
  resolvedStance?: GroupJudgementResolution;
  resolutionKind?: "creator";
  spaceId?: string;
  statement: string;
  stances: GroupJudgementStance[];
  status: GroupJudgementStatus;
  title: string;
};

export type GroupJudgementTally = {
  counted: number;
  leftCount: number;
  leftPercent: number;
  neutralCount: number;
  result: "left" | "right" | "tie" | "empty";
  rightCount: number;
  rightPercent: number;
  undecidedCount: number;
};

export function isCountedJudgementStance(stance: GroupJudgementStance) {
  return stance.source !== "ai_suggested" && (stance.stance === "left" || stance.stance === "right");
}

export function buildGroupJudgementTally(stances: GroupJudgementStance[], eligibleMemberIds?: string[]): GroupJudgementTally {
  const eligible = eligibleMemberIds ? new Set(eligibleMemberIds) : null;
  const latestByMember = new Map<string, GroupJudgementStance>();
  for (const stance of stances) {
    if (!eligible || eligible.has(stance.memberId)) latestByMember.set(stance.memberId, stance);
  }
  const latest = [...latestByMember.values()];
  const leftCount = latest.filter((item) => isCountedJudgementStance(item) && item.stance === "left").length;
  const rightCount = latest.filter((item) => isCountedJudgementStance(item) && item.stance === "right").length;
  const neutralCount = latest.filter((item) => item.source !== "ai_suggested" && item.stance === "neutral").length;
  const decidedMemberIds = new Set(latest.filter((item) => item.source !== "ai_suggested").map((item) => item.memberId));
  const undecidedCount = eligibleMemberIds
    ? eligibleMemberIds.filter((memberId) => !decidedMemberIds.has(memberId)).length
    : latest.filter((item) => item.source !== "ai_suggested" && item.stance === "undecided").length;
  const counted = leftCount + rightCount;
  const leftPercent = counted ? Math.round((leftCount / counted) * 100) : 50;
  const rightPercent = counted ? 100 - leftPercent : 50;
  return {
    counted,
    leftCount,
    leftPercent,
    neutralCount,
    result: counted === 0 ? "empty" : leftCount === rightCount ? "tie" : leftCount > rightCount ? "left" : "right",
    rightCount,
    rightPercent,
    undecidedCount
  };
}

export function buildNeutralJudgementSummary(judgement: GroupJudgement) {
  const tally = buildGroupJudgementTally(judgement.stances);
  if (tally.result === "empty") return "目前还没有成员确认立场。";
  if (tally.result === "tie") return `双方各有 ${tally.leftCount} 人确认，当前未形成多数。`;
  const leadingLabel = tally.result === "left" ? judgement.leftLabel : judgement.rightLabel;
  const leadingCount = tally.result === "left" ? tally.leftCount : tally.rightCount;
  return `多数人更支持：${leadingLabel}（${leadingCount} 人）。这只是成员立场汇总，不代表正确答案。`;
}

export function sanitizeGroupJudgementForViewer(judgement: GroupJudgement, viewerMemberId: string): GroupJudgement {
  return {
    ...judgement,
    stances: judgement.stances.filter((item) => item.source !== "ai_suggested" || item.memberId === viewerMemberId)
  };
}

export function isEligibleJudgementMember(member: { householdRoles?: string[]; relationshipRole?: string }) {
  return member.relationshipRole !== "guest" && !member.householdRoles?.includes("assistant");
}
