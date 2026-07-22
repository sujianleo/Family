const weekdayLabels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

export function formatTaskListDateTime(dueAt: string, now = new Date()) {
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return null;

  const includeYear = due.getFullYear() !== now.getFullYear();
  const date = includeYear
    ? `${due.getFullYear()}/${due.getMonth() + 1}/${due.getDate()}`
    : `${due.getMonth() + 1}/${due.getDate()}`;
  const time = `${String(due.getHours()).padStart(2, "0")}:${String(due.getMinutes()).padStart(2, "0")}`;
  const weekday = weekdayLabels[due.getDay()];

  return [date, weekday, time].join(" ");
}
