import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { normalizePhoneNumber } from "../phoneAuth";
import { isLiteBackend } from "./familyBackend";
import { readLiteAccounts } from "./liteRepository";

const sessionMaxAgeSeconds = 30 * 24 * 60 * 60;
const secureCookieName = "__Host-family_session";
const localCookieName = "family_session";
const attempts = new Map<string, { count: number; lockedUntil: number; windowStartedAt: number }>();

type LocalAuthRole = "admin" | "member";
type LocalAccount = {
  familyId?: string;
  memberId: string;
  passwordHash: string;
  phone: string;
  role: LocalAuthRole;
  sub: string;
};
type LocalSession = { exp: number; familyId?: string; iat: number; memberId: string; role: LocalAuthRole; sub: string };

export function isLocalAuthConfigured() {
  return Boolean(readLocalAccounts().length > 0 && process.env.FAMILY_APP_LOCAL_AUTH_SESSION_SECRET);
}

export async function authenticateLocalLogin(phone: string, password: string, request: Request) {
  const normalizedPhone = normalizePhoneNumber(phone);
  const keys = [`phone:${normalizedPhone || "invalid"}`, `ip:${clientIp(request)}`];
  if (keys.some(isLocked)) return { ok: false as const, rateLimited: true };

  const accounts = readLocalAccounts();
  const temporaryAccess = process.env.FAMILY_APP_LOCAL_AUTH_TEMPORARY_ANY_PASSWORD === "1";
  const account = temporaryAccess ? accounts[0] : accounts.find((candidate) => candidate.phone === normalizedPhone);
  const validPassword = account && normalizedPhone && password
    ? temporaryAccess || await verifyPassword(password, account.passwordHash)
    : false;
  if (!account || !validPassword) {
    keys.forEach(recordFailure);
    return { ok: false as const, rateLimited: false };
  }

  keys.forEach((key) => attempts.delete(key));
  return { ok: true as const, token: createSessionToken(account), maxAge: sessionMaxAgeSeconds, role: account.role };
}

export function readLocalSession(request: Request) {
  const cookies = parseCookies(request.headers.get("cookie") || "");
  return verifySessionToken(cookies[secureCookieName] || cookies[localCookieName] || "");
}

export function localAuthContext(session?: LocalSession | null) {
  return {
    familyId: session?.familyId || process.env.FAMILY_APP_LOCAL_AUTH_FAMILY_ID || "local-family",
    memberId: session?.memberId || process.env.FAMILY_APP_LOCAL_AUTH_MEMBER_ID || "me",
    userId: session?.sub || "local-admin"
  };
}

export function sessionCookie(request: Request, token: string, maxAge = sessionMaxAgeSeconds) {
  const secure = isSecureRequest(request);
  return { name: secure ? secureCookieName : localCookieName, value: token, options: { httpOnly: true, maxAge, path: "/", sameSite: "strict" as const, secure } };
}

export function allSessionCookieNames() {
  return [secureCookieName, localCookieName];
}

export async function createPasswordHash(password: string, salt = randomBytes(16).toString("base64url")) {
  const derived = await derivePassword(password, salt);
  return `scrypt$131072$8$1$${salt}$${derived.toString("base64url")}`;
}

async function verifyPassword(password: string, encoded: string) {
  const [algorithm, n, r, p, salt, expected] = encoded.split("$");
  if (algorithm !== "scrypt" || n !== "131072" || r !== "8" || p !== "1" || !salt || !expected) return false;
  const actual = await derivePassword(password, salt);
  const expectedBuffer = Buffer.from(expected, "base64url");
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}

function derivePassword(password: string, salt: string) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key));
  });
}

function createSessionToken(account: LocalAccount) {
  const now = Math.floor(Date.now() / 1000);
  const payload: LocalSession = {
    exp: now + sessionMaxAgeSeconds,
    familyId: account.familyId,
    iat: now,
    memberId: account.memberId,
    role: account.role,
    sub: account.sub
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

function verifySessionToken(token: string) {
  const [encoded, providedSignature] = token.split(".");
  if (!encoded || !providedSignature) return null;
  const expectedSignature = sign(encoded);
  const provided = Buffer.from(providedSignature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<LocalSession>;
    if (!parsed.sub || !["admin", "member"].includes(parsed.role || "") || !parsed.exp || parsed.exp <= Math.floor(Date.now() / 1000)) return null;
    return {
      exp: parsed.exp,
      familyId: parsed.familyId,
      iat: parsed.iat || 0,
      memberId: parsed.memberId || process.env.FAMILY_APP_LOCAL_AUTH_MEMBER_ID || "me",
      role: parsed.role as LocalAuthRole,
      sub: parsed.sub
    };
  } catch {
    return null;
  }
}

function readLocalAccounts(): LocalAccount[] {
  const accounts: LocalAccount[] = [];
  if (isLiteBackend()) {
    readLiteAccounts().forEach((account) => accounts.push(account));
  }
  const primaryPhone = normalizePhoneNumber(process.env.FAMILY_APP_LOCAL_AUTH_PHONE || "");
  const primaryPasswordHash = process.env.FAMILY_APP_LOCAL_AUTH_PASSWORD_HASH || "";
  if (primaryPhone && primaryPasswordHash) {
    accounts.push({
      memberId: process.env.FAMILY_APP_LOCAL_AUTH_MEMBER_ID || "me",
      passwordHash: primaryPasswordHash,
      phone: primaryPhone,
      role: "admin",
      sub: "local-admin"
    });
  }
  try {
    const configured = JSON.parse(process.env.FAMILY_APP_LOCAL_AUTH_ACCOUNTS_JSON || "[]") as Array<Partial<LocalAccount>>;
    configured.forEach((candidate, index) => {
      const phone = normalizePhoneNumber(candidate.phone || "");
      if (!phone || !candidate.passwordHash || !candidate.memberId) return;
      accounts.push({
        memberId: candidate.memberId,
        passwordHash: candidate.passwordHash,
        phone,
        role: candidate.role === "admin" ? "admin" : "member",
        sub: candidate.sub || `local-member-${index + 1}`
      });
    });
  } catch {
    // Ignore malformed optional secondary-account configuration.
  }
  return accounts;
}

function sign(value: string) {
  return createHmac("sha256", process.env.FAMILY_APP_LOCAL_AUTH_SESSION_SECRET || "missing-local-auth-secret").update(value).digest("base64url");
}

function parseCookies(header: string) {
  return Object.fromEntries(header.split(";").map((part) => part.trim().split("=")).filter(([name, value]) => Boolean(name && value)).map(([name, ...value]) => [name, value.join("=")]));
}

function isSecureRequest(request: Request) {
  return request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https" || new URL(request.url).protocol === "https:";
}

function clientIp(request: Request) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function isLocked(key: string) {
  const entry = attempts.get(key);
  return Boolean(entry && entry.lockedUntil > Date.now());
}

function recordFailure(key: string) {
  const now = Date.now();
  const current = attempts.get(key);
  const entry = !current || now - current.windowStartedAt > 15 * 60_000 ? { count: 0, lockedUntil: 0, windowStartedAt: now } : current;
  entry.count += 1;
  if (entry.count >= 5) entry.lockedUntil = now + 15 * 60_000;
  attempts.set(key, entry);
}
