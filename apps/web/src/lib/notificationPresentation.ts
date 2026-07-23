import type { FamilyNotification } from "./notifications";
import { taskTitleFromDueNotification } from "./taskNotificationCopy";
import type { FamilyMember } from "./types";

export type NotificationPresentation = {
  member: FamilyMember;
  isAi: boolean;
  state: "normal" | "urgent" | "complete" | "ai";
  title: string;
  subtitle: string;
};

export function buildNotificationPresentation(item: FamilyNotification, members: FamilyMember[], now = Date.now()): NotificationPresentation {
  const member = resolveNotificationMember(item, members);
  const isAi = item.type !== "task_due" && (/(?:饭米粒|\bAI\b|智能总结|家庭总结)/i.test(`${item.title} ${item.body}`) || member.householdRoles?.includes("assistant") === true);
  if (isAi) return { member, isAi, state: "ai", title: item.title, subtitle: "家庭动态总结" };
  if (item.type === "decision_closed") return { member, isAi, state: "complete", title: item.body || item.title, subtitle: `${member.displayName}发起 · 家庭决定已完成` };
  if (item.type === "decision_invited" || item.type === "decision_due") return { member, isAi, state: item.type === "decision_due" ? "urgent" : "normal", title: item.body || item.title, subtitle: `${member.displayName}邀请 · ${item.type === "decision_due" ? formatDeadline(item.scheduledFor, now) : "等待你的决定"}` };
  if (item.type === "task_due") return { member, isAi, state: "urgent", title: taskTitleFromDueNotification(item.title, item.body), subtitle: `${member.displayName}提醒 · ${formatDeadline(item.scheduledFor, now)}` };
  if (item.type === "task_assigned") return { member, isAi, state: "normal", title: item.body || item.title, subtitle: `${member.displayName}发起 · 待处理` };
  return { member, isAi, state: "normal", title: item.title, subtitle: `${member.displayName} · ${stripSenderPrefix(item.body)}` };
}

function resolveNotificationMember(item: FamilyNotification, members: FamilyMember[]) {
  const byId = item.actorMemberId ? members.find((member) => member.id === item.actorMemberId) : undefined;
  if (byId) return byId;
  const text = `${item.title} ${item.body}`;
  const byName = members.find((member) => text.includes(member.displayName));
  if (byName) return byName;
  return members.find((member) => member.id !== "me" && !member.householdRoles?.includes("assistant")) || members[0] || { id: "family", displayName: "家人", role: "家庭成员", status: "away", avatarSeed: "family" };
}

function stripSenderPrefix(value: string) { return value.replace(/^[^：:]{1,12}[：:]\s*/, "") || "发来一条新消息"; }

function formatDeadline(value: string, now: number) {
  const deadline = new Date(value).getTime();
  if (!Number.isFinite(deadline)) return "临近截止";
  const minutes = Math.max(0, Math.round((deadline - now) / 60_000));
  if (minutes < 1) return "现在截止";
  if (minutes < 60) return `距离截止${minutes}分钟`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `距离截止${hours}小时` : `距离截止${Math.round(hours / 24)}天`;
}
