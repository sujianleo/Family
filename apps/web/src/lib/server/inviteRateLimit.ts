import { InviteAccessError } from "./inviteAccess";

const windowMs = 15 * 60_000;
const attempts = new Map<string, number[]>();

export function checkInviteRateLimit(request: Request, inviteId: string, scope: "verify" | "accept") {
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const key = `${scope}:${ip}:${inviteId}`;
  const now = Date.now();
  const recent = (attempts.get(key) || []).filter((time) => now - time < windowMs);
  attempts.set(key, recent);
  if (recent.length >= 8) throw new InviteAccessError("尝试次数过多，请稍后再试。", 429);
  return () => attempts.set(key, [...recent, Date.now()]);
}
