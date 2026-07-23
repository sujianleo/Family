export type TemporalMode = "record" | "reminder";
import type { TaskRecurrence } from "./types";

export type TemporalPrecision = "none" | "date" | "minute" | "duration" | "recurrence";

export type TemporalMention = {
  end: number;
  kind: "absolute" | "recurring" | "relative";
  start: number;
  text: string;
};

export type TemporalParseResult = {
  displayText?: string;
  end?: number;
  instant?: string;
  matchedText?: string;
  occurredOn?: string;
  precision: TemporalPrecision;
  recurrence?: TaskRecurrence;
  requiresClarification: boolean;
  clarificationMessage?: string;
  start?: number;
  timeZone: string;
};

const numberPattern = "[零〇一二两三四五六七八九十百\\d]+";
const secondUnitPattern = "(?:秒(?:钟)?|[sS](?:ec(?:ond)?s?)?)";
const durationPattern = `(?:半\\s*小时|${numberPattern}\\s*周|${numberPattern}\\s*天|${numberPattern}\\s*小时(?:\\s*${numberPattern}\\s*分钟)?(?:\\s*${numberPattern}\\s*${secondUnitPattern})?|${numberPattern}\\s*分钟(?:\\s*${numberPattern}\\s*${secondUnitPattern})?|${numberPattern}\\s*${secondUnitPattern})`;
const relativePattern = `(?:过\\s*${durationPattern}|${durationPattern}\\s*(?:之?后|以后))`;
const relativeDatePattern = "(?:大后天|前天|昨天|今天|明天|后天|明早|明晚|今晚)";
const weekdayPattern = "(?:(?:本|这|下下|下)?(?:周|星期)[一二三四五六日天]|(?:本|这|下下|下)?周末)";
const weekPeriodPattern = "(?:(?:本|这|下下|下)(?:周|星期))";
const explicitDatePattern = "(?:\\d{4}\\s*(?:年|[-/.])\\s*\\d{1,2}\\s*(?:月|[-/.])\\s*\\d{1,2}\\s*(?:日|号)?|\\d{1,2}\\s*(?:月|[-/.])\\s*\\d{1,2}\\s*(?:日|号)?)";
const periodPattern = "(?:早上|上午|中午|下午|傍晚|晚上|今晚|夜里|凌晨|明早|明晚|a\\.?m\\.?|p\\.?m\\.?)";
const clockPattern = `(?:${numberPattern}\\s*(?:点|时)(?:\\s*(?:半|一刻|三刻|${numberPattern}\\s*分?))?|\\d{1,2}\\s*[:：]\\s*\\d{1,2}|\\d{1,2}\\s*(?:a\\.?m\\.?|p\\.?m\\.?))`;

const absolutePatterns = [
  `(?:${explicitDatePattern}|${relativeDatePattern}|${weekdayPattern}|${weekPeriodPattern})(?:\\s*${periodPattern})?(?:\\s*${clockPattern})?`,
  `${periodPattern}(?:\\s*${clockPattern})?`,
  clockPattern
];
const recurringPatterns = [
  `每\s*(?:隔\s*)?${numberPattern}\s*(?:天|周)(?:\s*${periodPattern})?(?:\s*${clockPattern})?`,
  `每\s*(?:天|日|个?工作日)(?:\s*${periodPattern})?(?:\s*${clockPattern})?`,
  `每\s*(?:周|星期)\s*(?:工作日|[一二三四五六日天])?(?:\s*${periodPattern})?(?:\s*${clockPattern})?`,
  `每\s*月(?:\s*${numberPattern}\s*(?:号|日))?(?:\s*${periodPattern})?(?:\s*${clockPattern})?`,
  `工作日(?:\s*${periodPattern})?(?:\s*${clockPattern})?`
];

export function extractTemporalMentions(text: string): TemporalMention[] {
  const candidates: TemporalMention[] = [];
  for (const pattern of recurringPatterns) {
    collectMatches(text, pattern, "recurring", candidates);
  }
  collectMatches(text, relativePattern, "relative", candidates);
  for (const pattern of absolutePatterns) {
    collectMatches(text, pattern, "absolute", candidates);
  }

  return candidates
    .sort((left, right) => left.start - right.start || right.end - left.end)
    .filter((candidate, index, mentions) => !mentions.slice(0, index).some((accepted) => candidate.start < accepted.end && candidate.end > accepted.start));
}

export function parseTemporalExpression(
  text: string,
  reference = new Date(),
  requestedTimeZone = "Asia/Shanghai",
  mode: TemporalMode = "record"
): TemporalParseResult {
  const timeZone = normalizeTimeZone(requestedTimeZone);
  const mention = extractTemporalMentions(text)[0];
  if (!mention) {
    return { precision: "none", requiresClarification: false, timeZone };
  }

  if (mention.kind === "relative") {
    const durationMs = parseRelativeDurationMilliseconds(mention.text);
    if (durationMs <= 0) {
      return invalidResult(mention, timeZone, "没有识别出有效的相对时间。");
    }
    return {
      ...mentionResult(mention, timeZone),
      instant: new Date(reference.getTime() + durationMs).toISOString(),
      precision: "duration",
      requiresClarification: false
    };
  }

  if (mention.kind === "recurring") {
    return {
      ...mentionResult(mention, timeZone),
      precision: "recurrence",
      recurrence: parseRecurrenceRule(mention.text),
      requiresClarification: false
    };
  }

  return parseAbsoluteMention(mention, reference, timeZone, mode);
}

function parseRecurrenceRule(text: string): TaskRecurrence {
  const compact = text.replace(/\s+/g, "");
  if (/工作日/.test(compact)) {
    return { interval: 1, kind: "weekdays", label: text, weekdays: [1, 2, 3, 4, 5] };
  }
  const intervalDays = compact.match(new RegExp(`每(?:隔)?(${numberPattern})天`));
  if (intervalDays) {
    return { interval: Math.max(1, parseChineseNumber(intervalDays[1])), kind: "interval_days", label: text };
  }
  const intervalWeeks = compact.match(new RegExp(`每(?:隔)?(${numberPattern})周`));
  if (intervalWeeks) {
    return { interval: Math.max(1, parseChineseNumber(intervalWeeks[1])), kind: "interval_weeks", label: text };
  }
  if (/每天|每日/.test(compact)) {
    return { interval: 1, kind: "daily", label: text };
  }
  const weekly = compact.match(/每(?:周|星期)([一二三四五六日天])?/);
  if (weekly) {
    return {
      interval: 1,
      kind: "weekly",
      label: text,
      ...(weekly[1] ? { weekdays: [weekdayNumber(weekly[1])] } : {})
    };
  }
  const monthly = compact.match(new RegExp(`每月(?:(${numberPattern})(?:号|日))?`));
  return {
    ...(monthly?.[1] ? { dayOfMonth: parseChineseNumber(monthly[1]) } : {}),
    interval: 1,
    kind: "monthly",
    label: text
  };
}

export function normalizeTimeZone(value: string | undefined) {
  const candidate = value?.trim() || "Asia/Shanghai";
  try {
    new Intl.DateTimeFormat("en", { timeZone: candidate }).format(0);
    return candidate;
  } catch {
    return "Asia/Shanghai";
  }
}

export function zonedDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value || 0);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute") };
}

export function zonedDateToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string) {
  const wallClock = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = new Date(wallClock);
  for (let index = 0; index < 3; index += 1) {
    const local = zonedDateParts(candidate, timeZone);
    const represented = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
    candidate = new Date(candidate.getTime() + wallClock - represented);
  }
  return candidate;
}

function collectMatches(text: string, pattern: string, kind: TemporalMention["kind"], candidates: TemporalMention[]) {
  for (const match of text.matchAll(new RegExp(pattern, "g"))) {
    const value = match[0];
    const start = match.index;
    if (!value || start === undefined) continue;
    candidates.push({ start, end: start + value.length, kind, text: value });
  }
}

function parseAbsoluteMention(mention: TemporalMention, reference: Date, timeZone: string, mode: TemporalMode): TemporalParseResult {
  const localReference = zonedDateParts(reference, timeZone);
  const date = resolveCalendarDate(mention.text, localReference, mode);
  if (!date || !isValidCalendarDate(date.year, date.month, date.day)) {
    return invalidResult(mention, timeZone, "这个日期无效，请重新指定。");
  }

  const clock = resolveClock(mention.text);
  if (clock.invalid) {
    return invalidResult(mention, timeZone, "这个时间无效，请重新指定。");
  }

  if (!clock.hasTime && mode === "record") {
    return {
      ...mentionResult(mention, timeZone),
      occurredOn: formatLocalDate(date.year, date.month, date.day),
      precision: "date",
      requiresClarification: false
    };
  }

  const hour = clock.hasTime ? clock.hour : 9;
  const minute = clock.hasTime ? clock.minute : 0;
  if (clock.ambiguous) {
    return {
      ...mentionResult(mention, timeZone),
      occurredOn: formatLocalDate(date.year, date.month, date.day),
      precision: "date",
      requiresClarification: true,
      clarificationMessage: "请说明是上午还是下午。"
    };
  }

  const instant = zonedDateToUtc(date.year, date.month, date.day, hour, minute, timeZone);
  const represented = zonedDateParts(instant, timeZone);
  if (represented.year !== date.year || represented.month !== date.month || represented.day !== date.day || represented.hour !== hour || represented.minute !== minute) {
    return invalidResult(mention, timeZone, "这个本地时间不存在或正处于时区切换，请重新指定。");
  }

  const pastReminder = mode === "reminder" && instant.getTime() <= reference.getTime();
  return {
    ...mentionResult(mention, timeZone),
    instant: instant.toISOString(),
    occurredOn: formatLocalDate(date.year, date.month, date.day),
    precision: "minute",
    requiresClarification: pastReminder,
    clarificationMessage: pastReminder ? "这个提醒时间已经过去了，请重新指定一个未来时间。" : undefined
  };
}

function resolveCalendarDate(text: string, current: ReturnType<typeof zonedDateParts>, mode: TemporalMode) {
  const isoLike = text.match(/(?:(\d{4})\s*(?:年|[-/.])\s*)?(\d{1,2})\s*(?:月|[-/.])\s*(\d{1,2})\s*(?:日|号)?/);
  if (isoLike) {
    let year = isoLike[1] ? Number(isoLike[1]) : current.year;
    const month = Number(isoLike[2]);
    const day = Number(isoLike[3]);
    if (!isoLike[1] && mode === "reminder" && compareDate({ year, month, day }, current) < 0) year += 1;
    return { year, month, day };
  }

  const relativeOffsets: Array<[RegExp, number]> = [
    [/大后天/, 3],
    [/后天/, 2],
    [/明天|明早|明晚/, 1],
    [/今天|今晚/, 0],
    [/昨天/, -1],
    [/前天/, -2]
  ];
  const relative = relativeOffsets.find(([pattern]) => pattern.test(text));
  if (relative) return addCalendarDays(current, relative[1]);

  const weekPeriod = text.match(/(本|这|下下|下)(?:周|星期)(?![一二三四五六日天末])/);
  if (weekPeriod) {
    const currentDay = utcWeekday(current.year, current.month, current.day);
    const currentWeekMondayOffset = currentDay === 0 ? -6 : 1 - currentDay;
    const weekOffset = weekPeriod[1] === "下下" ? 14 : weekPeriod[1] === "下" ? 7 : 0;
    return addCalendarDays(current, currentWeekMondayOffset + weekOffset);
  }

  const weekday = text.match(/((?:本|这|下下|下)?)(?:周|星期)([一二三四五六日天])|((?:本|这|下下|下)?)周末/);
  if (weekday) {
    const prefix = weekday[1] ?? weekday[3] ?? "";
    const targetDay = weekday[2] ? weekdayNumber(weekday[2]) : 6;
    const currentDay = utcWeekday(current.year, current.month, current.day);
    let offset: number;
    if (prefix === "下下") offset = targetDay - currentDay + 14;
    else if (prefix === "下") offset = targetDay - currentDay + 7;
    else if (prefix === "本" || prefix === "这") offset = targetDay - currentDay;
    else offset = (targetDay - currentDay + 7) % 7;
    return addCalendarDays(current, offset);
  }

  return { year: current.year, month: current.month, day: current.day };
}

function resolveClock(text: string) {
  const period = text.match(/早上|上午|中午|下午|傍晚|晚上|今晚|夜里|凌晨|明早|明晚|a\.?m\.?|p\.?m\.?/i)?.[0] || "";
  const colon = text.match(/(\d{1,2})\s*[:：]\s*(\d{1,2})/);
  const meridiem = text.match(/(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)/i);
  const chinese = text.match(new RegExp(`(${numberPattern})\\s*(?:点|时)(?:\\s*(半|一刻|三刻|${numberPattern}\\s*分?))?`));
  const hasClock = Boolean(colon || meridiem || chinese);
  if (!hasClock && !period) return { ambiguous: false, hasTime: false, hour: 0, invalid: false, minute: 0 };

  let hour = colon ? Number(colon[1]) : meridiem ? Number(meridiem[1]) : chinese ? parseChineseNumber(chinese[1]) : defaultPeriodHour(period);
  let minute = colon ? Number(colon[2]) : parseMinute(chinese?.[2]);
  const explicitPeriod = Boolean(period);
  if (/下午|傍晚|晚上|今晚|夜里|明晚/.test(period) && hour < 12) hour += 12;
  if (/p\.?m\.?/i.test(period) && hour < 12) hour += 12;
  if (/a\.?m\.?/i.test(period) && hour === 12) hour = 0;
  if (/凌晨/.test(period) && hour === 12) hour = 0;
  if (/中午/.test(period) && hour < 11) hour += 12;
  const ambiguous = Boolean(chinese) && !explicitPeriod && hour >= 1 && hour <= 6;
  return { ambiguous, hasTime: true, hour, invalid: hour > 23 || minute > 59, minute };
}

function defaultPeriodHour(period: string) {
  if (/凌晨/.test(period)) return 5;
  if (/早上|上午|明早/.test(period)) return 9;
  if (/中午/.test(period)) return 12;
  if (/下午/.test(period)) return 15;
  if (/傍晚/.test(period)) return 18;
  return 19;
}

function parseMinute(value: string | undefined) {
  if (!value) return 0;
  if (value === "半") return 30;
  if (value === "一刻") return 15;
  if (value === "三刻") return 45;
  return parseChineseNumber(value.replace(/分$/, ""));
}

function parseRelativeDurationMilliseconds(text: string) {
  const value = text.replace(/^过\s*/, "").replace(/\s*(?:之?后|以后)$/, "");
  if (/半\s*小时/.test(value)) return 30 * 60_000;
  const weeks = value.match(new RegExp(`(${numberPattern})\\s*周`));
  const days = value.match(new RegExp(`(${numberPattern})\\s*天`));
  const hours = value.match(new RegExp(`(${numberPattern})\\s*小时`));
  const minutes = value.match(new RegExp(`(${numberPattern})\\s*分钟`));
  const seconds = value.match(new RegExp(`(${numberPattern})\\s*${secondUnitPattern}`));
  return (weeks?.[1] ? parseChineseNumber(weeks[1]) * 7 * 86_400_000 : 0)
    + (days?.[1] ? parseChineseNumber(days[1]) * 86_400_000 : 0)
    + (hours?.[1] ? parseChineseNumber(hours[1]) * 3_600_000 : 0)
    + (minutes?.[1] ? parseChineseNumber(minutes[1]) * 60_000 : 0)
    + (seconds?.[1] ? parseChineseNumber(seconds[1]) * 1_000 : 0);
}

function parseChineseNumber(value: string): number {
  const normalized = value.trim();
  if (/^\d+$/.test(normalized)) return Number(normalized);
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (!normalized) return 0;
  if (normalized === "十") return 10;
  if (normalized.includes("百")) {
    const [hundreds, rest = ""] = normalized.split("百");
    return (digits[hundreds] || 1) * 100 + parseChineseNumber(rest || "零");
  }
  if (normalized.includes("十")) {
    const [tens, ones = ""] = normalized.split("十");
    return (tens ? digits[tens] || 0 : 1) * 10 + (ones ? digits[ones] || 0 : 0);
  }
  return [...normalized].reduce((total, digit) => total * 10 + (digits[digit] || 0), 0);
}

function addCalendarDays(current: { year: number; month: number; day: number }, offset: number) {
  const calendar = new Date(Date.UTC(current.year, current.month - 1, current.day));
  calendar.setUTCDate(calendar.getUTCDate() + offset);
  return { year: calendar.getUTCFullYear(), month: calendar.getUTCMonth() + 1, day: calendar.getUTCDate() };
}

function compareDate(left: { year: number; month: number; day: number }, right: { year: number; month: number; day: number }) {
  return Date.UTC(left.year, left.month - 1, left.day) - Date.UTC(right.year, right.month - 1, right.day);
}

function utcWeekday(year: number, month: number, day: number) {
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return dayOfWeek === 0 ? 7 : dayOfWeek;
}

function weekdayNumber(value: string) {
  return ({ 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 } as Record<string, number>)[value] || 1;
}

function isValidCalendarDate(year: number, month: number, day: number) {
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year && value.getUTCMonth() + 1 === month && value.getUTCDate() === day;
}

function formatLocalDate(year: number, month: number, day: number) {
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function mentionResult(mention: TemporalMention, timeZone: string) {
  return {
    displayText: mention.text.replace(/\s+/g, " ").trim(),
    end: mention.end,
    matchedText: mention.text,
    start: mention.start,
    timeZone
  };
}

function invalidResult(mention: TemporalMention, timeZone: string, message: string): TemporalParseResult {
  return {
    ...mentionResult(mention, timeZone),
    precision: "none",
    requiresClarification: true,
    clarificationMessage: message
  };
}
