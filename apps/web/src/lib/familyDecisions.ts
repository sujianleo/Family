import type { NotificationType } from "./notifications";

export type FamilyDecisionStatus = "open" | "closed" | "canceled";
export type FamilyDecisionCloseReason = "all_voted" | "deadline" | "creator";
export type FamilyDecisionSummaryStatus = "pending" | "ready" | "failed";

export type FamilyDecisionOption = {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  position: number;
  voteCount?: number;
  voterMemberIds?: string[];
  percentage?: number;
};

export type FamilyDecisionParticipant = { memberId: string; hasVoted: boolean };
export type FamilyDecisionBallot = { id: string; memberId: string; optionId: string; updatedAt: string };
export type FamilyDecisionMessage = {
  id: string;
  memberId: string;
  memberName?: string;
  body: string;
  messageType: "text" | "voice" | "file" | "system";
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type FamilyDecision = {
  id: string;
  familyId: string;
  roomRecordId: string;
  creatorMemberId: string;
  question: string;
  status: FamilyDecisionStatus;
  closesAt: string;
  createdAt: string;
  closedAt?: string;
  closeReason?: FamilyDecisionCloseReason;
  summaryStatus?: FamilyDecisionSummaryStatus;
  summaryText?: string;
  summaryJson?: FamilyDecisionResult;
  adoptedTaskId?: string;
  participants: FamilyDecisionParticipant[];
  options: FamilyDecisionOption[];
  ballots: FamilyDecisionBallot[];
  messages: FamilyDecisionMessage[];
};

export type ChatTimelineItem<Message extends { id: string; createdAt: string }> =
  | { kind: "message"; id: string; createdAt: string; message: Message }
  | { kind: "poll"; id: string; createdAt: string; poll: FamilyDecision };

export type DecisionCandidate = {
  question: string;
  options: string[];
  closesAt: string;
  sourceText: string;
  requiresClarification: boolean;
};

export type FamilyDecisionResult = {
  options: Array<FamilyDecisionOption & { voteCount: number; voterMemberIds: string[]; percentage: number }>;
  totalVotes: number;
  isTie: boolean;
  recommendation: string;
};

export type DecisionNotificationEvent = {
  recipientMemberId: string;
  type: Extract<NotificationType, "decision_invited" | "decision_due" | "decision_closed">;
  title: string;
  body: string;
  scheduledFor: string;
  dedupeKey: string;
};

export function mergeChatTimelineItems<Message extends { id: string; createdAt: string }>(messages: Message[], polls: FamilyDecision[]): ChatTimelineItem<Message>[] {
  return [
    ...messages.map((message) => ({ kind: "message" as const, id: message.id, createdAt: message.createdAt, message })),
    ...polls.map((poll) => ({ kind: "poll" as const, id: poll.id, createdAt: poll.createdAt, poll }))
  ].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

export function isPollWakeKeyword(value: string) {
  return ["投票", "poll"].includes(value.trim().toLowerCase());
}

export function isPollKeywordPrefix(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && ["投票", "poll"].some((keyword) => keyword.startsWith(normalized));
}

const decisionPrefixes = /^(?:\s*\/(?:投票|决定)\s*|\s*(?:发起|创建|新建)?\s*家庭决定\s*[：:]?\s*|\s*大家(?:来)?选一下\s*[：:]?\s*)/u;

export function parseDecisionCandidate(sourceText: string, now = new Date()): DecisionCandidate {
  const normalized = sourceText.trim().replace(decisionPrefixes, "").trim();
  const questionMatch = normalized.match(/^(.+?[？?])(?:\s+|$)(.*)$/u);
  const questionSource = questionMatch?.[1] || "";
  const optionSource = questionMatch?.[2] || normalized;
  const parts = optionSource
    .split(/[|｜\n，,、；;]/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const question = (questionSource || parts.shift() || normalized).slice(0, 80);
  const options = [...new Set(parts)].slice(0, 8);
  return {
    question,
    options,
    closesAt: new Date(now.getTime() + 24 * 60 * 60_000).toISOString(),
    sourceText,
    requiresClarification: !question || options.length < 2
  };
}

export function sanitizeDecisionForViewer(decision: FamilyDecision, viewerMemberId: string): FamilyDecision {
  if (decision.status === "closed") {
    const result = buildDecisionResult(decision);
    return { ...decision, options: result.options };
  }
  return {
    ...decision,
    ballots: decision.ballots.filter((ballot) => ballot.memberId === viewerMemberId),
    options: decision.options.map(({ voteCount: _voteCount, voterMemberIds: _voters, ...option }) => option)
  };
}

export function buildDecisionResult(decision: FamilyDecision): FamilyDecisionResult {
  const totalVotes = decision.ballots.length;
  const options = decision.options.map((option) => {
    const voterMemberIds = decision.ballots.filter((ballot) => ballot.optionId === option.id).map((ballot) => ballot.memberId);
    return {
      ...option,
      voteCount: voterMemberIds.length,
      voterMemberIds,
      percentage: totalVotes ? Math.round((voterMemberIds.length / totalVotes) * 100) : 0
    };
  });
  const maxVotes = Math.max(0, ...options.map((option) => option.voteCount));
  const leaders = options.filter((option) => option.voteCount === maxVotes && maxVotes > 0);
  return {
    options,
    totalVotes,
    isTie: leaders.length !== 1,
    recommendation: leaders.length === 1 ? leaders[0].label : "未形成唯一多数"
  };
}

export function buildDecisionNotificationEvents(
  decision: FamilyDecision,
  event: "created" | "closed",
  now = new Date()
): DecisionNotificationEvent[] {
  if (event === "closed") {
    return decision.participants.map((participant) => ({
      recipientMemberId: participant.memberId,
      type: "decision_closed",
      title: "家庭决定已有结果",
      body: decision.question,
      scheduledFor: now.toISOString(),
      dedupeKey: `decision:${decision.id}:closed:${participant.memberId}`
    }));
  }
  const invited = decision.participants
    .filter((participant) => participant.memberId !== decision.creatorMemberId)
    .map((participant) => ({
      recipientMemberId: participant.memberId,
      type: "decision_invited" as const,
      title: "新的家庭决定",
      body: decision.question,
      scheduledFor: now.toISOString(),
      dedupeKey: `decision:${decision.id}:invited:${participant.memberId}`
    }));
  const reminderAt = new Date(new Date(decision.closesAt).getTime() - 15 * 60_000);
  const reminders = decision.participants
    .filter((participant) => !participant.hasVoted && reminderAt > now)
    .map((participant) => ({
      recipientMemberId: participant.memberId,
      type: "decision_due" as const,
      title: "家庭决定即将截止",
      body: decision.question,
      scheduledFor: reminderAt.toISOString(),
      dedupeKey: `decision:${decision.id}:due:${participant.memberId}`
    }));
  return [...invited, ...reminders];
}

export function shouldCloseDecision(decision: FamilyDecision, now = new Date()) {
  if (decision.status !== "open") return undefined;
  if (new Date(decision.closesAt).getTime() <= now.getTime()) return "deadline" as const;
  if (decision.participants.length > 0 && decision.participants.every((participant) => participant.hasVoted)) return "all_voted" as const;
  return undefined;
}
