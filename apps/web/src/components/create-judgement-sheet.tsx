"use client";

import { useState, type FormEvent } from "react";
import { familyFetch } from "@/lib/familyApi";
import type { GroupJudgement } from "@/lib/groupJudgement";
import type { FamilyMember, FamilyRecord } from "@/lib/types";

type Draft = { leftLabel: string; rightLabel: string; statement: string; title: string };

export function CreateJudgementSheet({ members, onClose, onCreated, roomRecord }: { members: FamilyMember[]; onClose: () => void; onCreated: (value: GroupJudgement) => void; roomRecord: FamilyRecord }) {
  const [statement, setStatement] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [leftMemberId, setLeftMemberId] = useState("");
  const [rightMemberId, setRightMemberId] = useState("");
  const [duration, setDuration] = useState("120");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function askAi(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await familyFetch("/api/group-judgements/draft", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ room_record_id: roomRecord.id, statement }) });
      const payload = await response.json() as { detail?: string; draft?: Draft };
      if (!response.ok || !payload.draft) throw new Error(payload.detail || "AI 整理失败。");
      setDraft(payload.draft);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "AI 整理失败。"); }
    finally { setBusy(false); }
  }

  async function create() {
    if (!draft) return;
    setBusy(true); setError("");
    try {
      const minutes = Number(duration);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);
      const endsAt = duration === "today" ? todayEnd.toISOString() : minutes > 0 ? new Date(Date.now() + minutes * 60_000).toISOString() : "";
      const response = await familyFetch("/api/group-judgements", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        ends_at: endsAt,
        left_label: draft.leftLabel,
        left_member_id: leftMemberId,
        right_label: draft.rightLabel,
        right_member_id: rightMemberId,
        room_record_id: roomRecord.id,
        space_id: roomRecord.spaceId || "",
        statement: draft.statement,
        title: draft.title
      }) });
      const payload = await response.json() as { detail?: string; judgement?: GroupJudgement };
      if (!response.ok || !payload.judgement) throw new Error(payload.detail || "发起失败。");
      onCreated(payload.judgement);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "发起失败。"); }
    finally { setBusy(false); }
  }

  return (
    <div className="judgement-sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="create-judgement-sheet" role="dialog" aria-modal="true" aria-label="发起评评理">
        <header><div><strong>发起评评理</strong><span>先讲清事实，再由 AI 整理双方观点</span></div><button type="button" aria-label="关闭发起评评理" onClick={onClose}>×</button></header>
        {!draft ? (
          <form onSubmit={askAi}>
            <label>事情经过<textarea autoFocus maxLength={1200} rows={7} value={statement} onChange={(event) => setStatement(event.target.value)} placeholder="请陈述发生了什么、各方做了什么，不必先下结论。" /></label>
            <p className="judgement-ai-note">AI 只负责整理争议点，正式发起前仍需你确认。</p>
            <button className="judgement-primary" disabled={busy || statement.trim().length < 10} type="submit">{busy ? "AI 正在整理…" : "让 AI 整理"}</button>
          </form>
        ) : (
          <div className="judgement-confirm-step">
            <span className="judgement-step-label">请确认 AI 的整理</span>
            <label>争议问题<input maxLength={80} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
            <div className="judgement-side-editors">
              <label>观点 A<input maxLength={30} value={draft.leftLabel} onChange={(event) => setDraft({ ...draft, leftLabel: event.target.value })} /><select value={leftMemberId} onChange={(event) => setLeftMemberId(event.target.value)}><option value="">不指定代表</option>{members.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label>
              <label>观点 B<input maxLength={30} value={draft.rightLabel} onChange={(event) => setDraft({ ...draft, rightLabel: event.target.value })} /><select value={rightMemberId} onChange={(event) => setRightMemberId(event.target.value)}><option value="">不指定代表</option>{members.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label>
            </div>
            <label>结束时间<select value={duration} onChange={(event) => setDuration(event.target.value)}><option value="30">30 分钟后</option><option value="120">2 小时后</option><option value="today">今天结束</option><option value="0">手动结束</option></select></label>
            <details><summary>查看原始事实陈述</summary><p>{draft.statement}</p></details>
            <div className="judgement-confirm-actions"><button type="button" onClick={() => setDraft(null)}>返回修改事实</button><button className="judgement-primary" disabled={busy} type="button" onClick={() => void create()}>{busy ? "正在发起…" : "确认并发起"}</button></div>
          </div>
        )}
        {error ? <p className="judgement-error" role="alert">{error}</p> : null}
      </section>
    </div>
  );
}
