"use client";

import { useState } from "react";
import { familyFetch } from "@/lib/familyApi";
import { buildGroupJudgementTally, type GroupJudgement, type JudgementStance } from "@/lib/groupJudgement";
import type { FamilyMember } from "@/lib/types";
import { MemberAvatar } from "./avatar";

export function GroupJudgementSheet({ currentMemberId, judgement, members, membersById, onChange, onClose }: { currentMemberId: string; judgement: GroupJudgement; members: FamilyMember[]; membersById: Map<string, FamilyMember>; onChange: (value: GroupJudgement) => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [error, setError] = useState("");
  const tally = buildGroupJudgementTally(judgement.stances);
  const myStance = judgement.stances.find((item) => item.memberId === currentMemberId && item.source !== "ai_suggested")?.stance;
  const expressedMemberIds = new Set(judgement.stances.filter((item) => item.source !== "ai_suggested" && item.stance !== "undecided").map((item) => item.memberId));
  const undecidedMemberIds = members.filter((member) => !expressedMemberIds.has(member.id)).map((member) => member.id);

  async function saveStance(stance: JudgementStance) {
    setBusy(true); setError("");
    try {
      const response = await familyFetch(`/api/group-judgements/${encodeURIComponent(judgement.id)}/stance`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ stance }) });
      const payload = await response.json() as { detail?: string; judgement?: GroupJudgement };
      if (!response.ok || !payload.judgement) throw new Error(payload.detail || "保存失败。");
      onChange(payload.judgement);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败。"); }
    finally { setBusy(false); }
  }

  async function closeJudgement() {
    setBusy(true); setError("");
    try {
      const response = await familyFetch(`/api/group-judgements/${encodeURIComponent(judgement.id)}/close`, { method: "POST" });
      const payload = await response.json() as { detail?: string; judgement?: GroupJudgement };
      if (!response.ok || !payload.judgement) throw new Error(payload.detail || "结束失败。");
      onChange(payload.judgement); setConfirmClose(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "结束失败。"); }
    finally { setBusy(false); }
  }

  async function postAction(path: "extend" | "resolve", body: Record<string, unknown>) {
    setBusy(true); setError("");
    try {
      const response = await familyFetch(`/api/group-judgements/${encodeURIComponent(judgement.id)}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as { detail?: string; judgement?: GroupJudgement };
      if (!response.ok || !payload.judgement) throw new Error(payload.detail || "操作失败。");
      onChange(payload.judgement);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败。"); }
    finally { setBusy(false); }
  }

  return (
    <div className="judgement-sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="group-judgement-sheet" role="dialog" aria-modal="true" aria-label={`评评理详情：${judgement.title}`}>
        <header><div><strong>{judgement.title}</strong><span>{judgement.status === "active" ? "进行中" : "已结束"}</span></div><button type="button" aria-label="关闭评评理详情" onClick={onClose}>×</button></header>
        <p className="judgement-statement">{judgement.statement}</p>
        <div className="judgement-tally" aria-label={`票数：观点 A ${tally.leftCount} 人，观点 B ${tally.rightCount} 人`}><strong>{judgement.leftLabel}<em>{tally.leftCount}</em></strong><i>VS</i><strong><em>{tally.rightCount}</em>{judgement.rightLabel}</strong></div>
        <div className="judgement-member-columns">
          <JudgementMembers label={judgement.leftLabel} memberIds={judgement.stances.filter((item) => item.source !== "ai_suggested" && item.stance === "left").map((item) => item.memberId)} membersById={membersById} />
          <JudgementMembers label={judgement.rightLabel} memberIds={judgement.stances.filter((item) => item.source !== "ai_suggested" && item.stance === "right").map((item) => item.memberId)} membersById={membersById} />
        </div>
        <JudgementMembers className="judgement-undecided-members" label="未表态" memberIds={undecidedMemberIds} membersById={membersById} />
        {judgement.status === "active" ? <><p className="judgement-my-stance">{myStance ? "修改我的选择" : "选择我的立场"}</p><div className="judgement-stance-actions" aria-label="选择我的立场"><button aria-label={`支持观点 A：${judgement.leftLabel}`} className={myStance === "left" ? "selected left" : "left"} disabled={busy} type="button" onClick={() => void saveStance("left")}>{judgement.leftLabel}</button><button className={myStance === "neutral" ? "selected" : ""} disabled={busy} type="button" onClick={() => void saveStance("neutral")}>保持中立</button><button aria-label={`支持观点 B：${judgement.rightLabel}`} className={myStance === "right" ? "selected right" : "right"} disabled={busy} type="button" onClick={() => void saveStance("right")}>{judgement.rightLabel}</button></div></> : <p className="judgement-summary">{judgement.neutralSummary}</p>}
        <details className="judgement-evidence"><summary>AI 识别依据</summary>{judgement.stances.filter((item) => item.evidenceText).map((item) => <p key={item.memberId}><strong>{membersById.get(item.memberId)?.displayName || "成员"}</strong>：{item.evidenceText}{item.evidenceMessageId ? <small>来源消息：{item.evidenceMessageId}</small> : null}</p>)}</details>
        <p className="judgement-undecided">中立 {tally.neutralCount} 人 · 尚未确认 {undecidedMemberIds.length} 人</p>
        {judgement.status === "closed" && tally.result === "tie" ? <div className="judgement-tie-actions"><strong>平局 · {tally.leftCount} : {tally.rightCount}</strong><button type="button" onClick={onClose}>继续讨论</button>{judgement.creatorMemberId === currentMemberId ? <><button disabled={busy} type="button" onClick={() => void postAction("extend", { minutes: 120 })}>延长 2 小时</button><span>由发起人决定：</span><button disabled={busy} type="button" onClick={() => void postAction("resolve", { stance: "left" })}>{judgement.leftLabel}</button><button disabled={busy} type="button" onClick={() => void postAction("resolve", { stance: "right" })}>{judgement.rightLabel}</button></> : null}</div> : null}
        {judgement.creatorMemberId === currentMemberId && judgement.status === "active" ? <div className="judgement-close-area">{confirmClose ? <><span>确认结束？结果只做汇总，不作裁决。</span><button disabled={busy} type="button" onClick={() => void closeJudgement()}>确认结束</button><button type="button" onClick={() => setConfirmClose(false)}>取消</button></> : <button type="button" onClick={() => setConfirmClose(true)}>结束评评理</button>}</div> : null}
        {error ? <p className="judgement-error" role="alert">{error}</p> : null}
      </section>
    </div>
  );
}

function JudgementMembers({ className, label, memberIds, membersById }: { className?: string; label: string; memberIds: string[]; membersById: Map<string, FamilyMember> }) {
  return <section className={className}><strong>{label}</strong>{memberIds.length ? memberIds.map((id) => { const member = membersById.get(id); return member ? <span key={id}><MemberAvatar member={member} />{member.displayName}</span> : null; }) : <small>暂无</small>}</section>;
}
