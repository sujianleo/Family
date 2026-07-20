export function normalizePhoneNumber(value: string, defaultCountryCode = "+86") {
  const compact = value.trim().replace(/[\s()-]/g, "");
  if (!compact) return "";
  if (/^\+\d{8,15}$/.test(compact)) return compact;
  if (/^1\d{10}$/.test(compact) && defaultCountryCode === "+86") return `${defaultCountryCode}${compact}`;
  return "";
}

export function phoneLoginErrorMessage(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid login credentials")) return "手机号或密码不正确。";
  if (normalized.includes("phone not confirmed")) return "该手机号尚未完成确认，请联系家庭管理员。";
  if (normalized.includes("rate limit")) return "尝试次数过多，请稍后再试。";
  return "暂时无法登录，请稍后重试。";
}
