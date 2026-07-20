import type { MemberProfile } from "./types";

export type MemberBirthCalendar = "lunar" | "solar";

type CalendarDateParts = {
  day: number;
  month: number;
  year: number;
};

const familyTimeZone = "Asia/Shanghai";

export function formatMemberBirthDateInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  return [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8)].filter(Boolean).join(" / ");
}

export function parseMemberBirthDateInput(value: string, calendar: MemberBirthCalendar = "solar") {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 8) return undefined;
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1) return undefined;
  if (calendar === "lunar") {
    if (day > 30) return undefined;
  } else {
    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return undefined;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function calculateMemberAge(birthDate: string, calendar: MemberBirthCalendar = "solar", referenceDate = new Date()) {
  const normalized = parseMemberBirthDateInput(birthDate, calendar);
  if (!normalized) return undefined;
  const [birthYear, birthMonth, birthDay] = normalized.split("-").map(Number);
  const current = readCalendarDate(referenceDate, calendar);
  const birthdayHasPassed = current.month > birthMonth || (current.month === birthMonth && current.day >= birthDay);
  const age = current.year - birthYear - (birthdayHasPassed ? 0 : 1);
  return age >= 0 && age <= 130 ? age : undefined;
}

export function memberBirthDatePickerMax(calendar: MemberBirthCalendar = "solar", referenceDate = new Date()) {
  const current = readCalendarDate(referenceDate, calendar);
  return `${String(current.year).padStart(4, "0")}-${String(current.month).padStart(2, "0")}-${String(current.day).padStart(2, "0")}`;
}

export function withCalculatedMemberAge(profile: MemberProfile | undefined, referenceDate = new Date()): MemberProfile | undefined {
  if (!profile?.birthDate) return profile;
  return {
    ...profile,
    age: calculateMemberAge(profile.birthDate, profile.birthCalendar || "solar", referenceDate)
  };
}

function readCalendarDate(referenceDate: Date, calendar: MemberBirthCalendar): CalendarDateParts {
  const locale = calendar === "lunar" ? "en-u-ca-chinese" : "en-CA";
  const parts = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "numeric",
    timeZone: familyTimeZone,
    year: "numeric"
  }).formatToParts(referenceDate);
  const value = (type: "day" | "month" | "relatedYear" | "year") => Number.parseInt(parts.find((part) => part.type === type)?.value || "", 10);
  const year = calendar === "lunar" ? value("relatedYear") : value("year");
  return { day: value("day"), month: value("month"), year };
}
