import type { RoomMessage } from "./types";

const timestampGapMinutes = 5;

export function shouldShowChatTimestamp(previous: RoomMessage | undefined, current: RoomMessage) {
  if (!previous) return true;
  const previousTime = parseMessageTime(previous.sentAt);
  const currentTime = parseMessageTime(current.sentAt);
  if (!previousTime || !currentTime) return false;
  if (previousTime.kind === "date" && currentTime.kind === "date") {
    return !isSameLocalDay(previousTime.value, currentTime.value)
      || currentTime.value.getTime() - previousTime.value.getTime() >= timestampGapMinutes * 60_000;
  }
  if (previousTime.kind === "clock" && currentTime.kind === "clock") {
    let gap = currentTime.minutes - previousTime.minutes;
    if (gap < -12 * 60) gap += 24 * 60;
    return gap >= timestampGapMinutes;
  }
  return false;
}

export function formatChatTimestamp(value: string, now = new Date()) {
  const parsed = parseMessageTime(value);
  if (!parsed) return value.trim() || "刚刚";
  if (parsed.kind === "clock") return `${String(Math.floor(parsed.minutes / 60)).padStart(2, "0")}:${String(parsed.minutes % 60).padStart(2, "0")}`;
  const time = parsed.value.toLocaleTimeString("zh-CN", { hour: "2-digit", hour12: false, minute: "2-digit" });
  if (isSameLocalDay(parsed.value, now)) return `今天 ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameLocalDay(parsed.value, yesterday)) return `昨天 ${time}`;
  if (parsed.value.getFullYear() === now.getFullYear()) return `${parsed.value.getMonth() + 1}月${parsed.value.getDate()}日 ${time}`;
  return `${parsed.value.getFullYear()}年${parsed.value.getMonth() + 1}月${parsed.value.getDate()}日 ${time}`;
}

function parseMessageTime(value: string): { kind: "clock"; minutes: number } | { kind: "date"; value: Date } | null {
  const normalized = value.trim();
  const clock = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (clock) {
    const hour = Number(clock[1]);
    const minute = Number(clock[2]);
    return hour <= 23 && minute <= 59 ? { kind: "clock", minutes: hour * 60 + minute } : null;
  }
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : { kind: "date", value: date };
}

function isSameLocalDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}
