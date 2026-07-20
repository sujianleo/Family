"use client";

import { buildGroupJudgementTally, type GroupJudgement } from "@/lib/groupJudgement";
import type { FamilyMember } from "@/lib/types";
import { MemberAvatar } from "./avatar";

export function GroupJudgementBar({ compact = false, dataCreatedAt, judgement, membersById, onOpen }: { compact?: boolean; dataCreatedAt?: string; judgement: GroupJudgement; membersById: Map<string, FamilyMember>; onOpen: () => void }) {
  const tally = buildGroupJudgementTally(judgement.stances);
  const leftMember = judgement.leftMemberId ? membersById.get(judgement.leftMemberId) : undefined;
  const rightMember = judgement.rightMemberId ? membersById.get(judgement.rightMemberId) : undefined;
  if (compact) {
    return (
      <button className="chat-context-collapse-bar group-judgement-bar compact" data-created-at={dataCreatedAt} type="button" onClick={onOpen} aria-label={`定位评评理：${judgement.title}；${judgement.leftLabel} ${tally.leftCount} 人，${judgement.rightLabel} ${tally.rightCount} 人`}>
        <b><i aria-hidden="true" />{judgement.status === "closed" ? "已结束" : "评评理"}</b>
        <strong>{judgement.title}</strong>
        <em>{tally.leftCount} : {tally.rightCount}</em>
        <span aria-hidden="true">›</span>
      </button>
    );
  }
  return (
    <button className="group-judgement-bar" type="button" onClick={onOpen} aria-label={`查看评评理：${judgement.title}；${judgement.leftLabel} ${tally.leftCount} 人，${judgement.rightLabel} ${tally.rightCount} 人`}>
      <span className="group-judgement-bar-title"><b>{judgement.status === "closed" ? "已结束" : "评评理"}</b> · {judgement.title}</span>
      <span className="group-judgement-versus">
        <strong className="left" style={{ flexBasis: `${tally.leftPercent}%` }}>{leftMember ? <MemberAvatar member={leftMember} /> : null}<span>{judgement.leftLabel}</span><em>{tally.leftPercent}% · {tally.leftCount}人</em></strong>
        <i aria-hidden="true">VS</i>
        <strong className="right" style={{ flexBasis: `${tally.rightPercent}%` }}><em>{tally.rightCount}人 · {tally.rightPercent}%</em><span>{judgement.rightLabel}</span>{rightMember ? <MemberAvatar member={rightMember} /> : null}</strong>
      </span>
    </button>
  );
}
