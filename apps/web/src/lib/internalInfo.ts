import type { FamilyMember } from "./types";
import { normalizeTimeZone } from "./temporal";

export function formatCurrentTimeAnswer(now: Date, requestedTimeZone: string) {
  const timeZone = normalizeTimeZone(requestedTimeZone);
  const parts = dateTimeParts(now, timeZone);
  return `现在是 ${parts.year}年${parts.month}月${parts.day}日 ${parts.weekday} ${parts.hour}:${parts.minute}（${timeZone}）。`;
}

export function formatCurrentDateAnswer(now: Date, requestedTimeZone: string) {
  const timeZone = normalizeTimeZone(requestedTimeZone);
  const parts = dateTimeParts(now, timeZone);
  return `今天是 ${parts.year}年${parts.month}月${parts.day}日，${parts.weekday}（${timeZone}）。`;
}

export function formatMemberCountAnswer(members: FamilyMember[]) {
  const groups = partitionMembers(members);
  const assistantText = groups.assistants.length ? `；另有 AI 助手 ${groups.assistants.length} 个` : "";
  const guestText = groups.guests.length ? `，访客 ${groups.guests.length} 位不计入家庭成员` : "";
  return `家里有 ${groups.people.length} 位家庭成员${assistantText}${guestText}。`;
}

export function formatMemberListAnswer(members: FamilyMember[]) {
  const groups = partitionMembers(members);
  const people = groups.people.map((member) => member.displayName).join("、") || "暂无家庭成员";
  const assistants = groups.assistants.map((member) => member.displayName).join("、");
  return `家庭成员：${people}${assistants ? `；AI 助手：${assistants}` : ""}。`;
}

export function partitionMembers(members: FamilyMember[]) {
  const guests = members.filter((member) => member.relationshipRole === "guest");
  const visible = members.filter((member) => member.relationshipRole !== "guest");
  const assistants = visible.filter((member) => member.householdRoles?.includes("assistant"));
  const people = visible.filter((member) => !member.householdRoles?.includes("assistant"));
  return { assistants, guests, people };
}

function dateTimeParts(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    weekday: value("weekday"),
    hour: value("hour").padStart(2, "0"),
    minute: value("minute").padStart(2, "0")
  };
}
