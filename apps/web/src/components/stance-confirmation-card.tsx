"use client";

import { useState } from "react";
import { familyFetch } from "@/lib/familyApi";
import type { GroupJudgement, JudgementStance } from "@/lib/groupJudgement";

export function StanceConfirmationCard({ judgement, memberId, onChange }: { judgement: GroupJudgement; memberId: string; onChange: (value: GroupJudgement) => void }) {
  const suggestion = judgement.stances.find((item) => item.memberId === memberId && item.source === "ai_suggested");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!suggestion) return null;

  async function update(body: Record<string, unknown>) {
    setBusy(true); setError("");
    try {
      const response = await familyFetch(`/api/group-judgements/${encodeURIComponent(judgement.id)}/stance`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as { detail?: string; judgement?: GroupJudgement };
      if (!response.ok || !payload.judgement) throw new Error(payload.detail || "确认失败。");
      onChange(payload.judgement);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "确认失败。"); }
    finally { setBusy(false); }
  }

  const suggestedLabel = stanceLabel(suggestion.stance, judgement);
  return (
    <aside className="stance-confirmation-card" aria-label="确认候选立场">
      <p>AI 觉得你刚才更接近“{suggestedLabel}”，这是你的真实立场吗？</p>
      {suggestion.evidenceText ? <small>依据：{suggestion.evidenceText}</small> : null}
      <div>
        <button disabled={busy} type="button" onClick={() => void update({ confirmed: true, stance: suggestion.stance })}>确认</button>
        <button disabled={busy} type="button" onClick={() => void update({ dismiss: true })}>不是</button>
        <button disabled={busy} type="button" onClick={() => void update({ confirmed: true, stance: "undecided" satisfies JudgementStance })}>暂不表态</button>
      </div>
      {error ? <span role="alert">{error}</span> : null}
    </aside>
  );
}

function stanceLabel(stance: JudgementStance, judgement: GroupJudgement) {
  if (stance === "left") return judgement.leftLabel;
  if (stance === "right") return judgement.rightLabel;
  if (stance === "neutral") return "中立";
  return "暂不确定";
}
