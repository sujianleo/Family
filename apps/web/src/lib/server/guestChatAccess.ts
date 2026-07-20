import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { familyMembers, familyRecords } from "../mockData";
import { getGuestChatSlug } from "../guestChat";
import { normalizePhoneNumber } from "../phoneAuth";
import { createServiceSupabaseClient } from "./supabaseServer";
import { requireInviteUser } from "./inviteAccess";
import type { FamilyMember, FamilyRecord, RoomMessage } from "../types";

// Legacy device-only guest mode is deliberately short lived. Durable identity
// is restored from auth.users + group_members, never from this cookie.
const guestSessionMaxAgeSeconds = 24 * 60 * 60;
const guestInviteRegistryPath = "data/guest-chat-invites.jsonl";

export type GuestChatIdentity = { id: string; displayName: string; phoneLast4: string };
export type GuestChatRoom = {
  groupId: string;
  id: string;
  familyId: string;
  spaceId?: string;
  title: string;
  chatMembers: string[];
  chatMessages: RoomMessage[];
  members: Pick<FamilyMember, "id" | "displayName" | "avatarSeed" | "status">[];
};

type GuestSession = GuestChatIdentity & { exp: number; familyId: string; iat: number; recordId: string; slug: string };
type RegisteredGuestInviteAccess = {
  codeHash: string;
  expiresAt: string;
  id: string;
  status: "active" | "revoked";
};

export async function authenticateGuestChat(phone: string, code: string, slug: string) {
  const normalizedPhone = normalizePhoneNumber(phone);
  if (!normalizedPhone) return { ok: false as const, status: 400 as const, detail: "请输入正确的手机号。" };
  if (!/^[A-Za-z0-9_-]{16,}$/.test(slug) || !/^\d{4}$/.test(code)) {
    return { ok: false as const, status: 401 as const, detail: "邀请链接或口令不正确。" };
  }
  const registeredAccess = await readRegisteredGuestInviteAccess(slug);
  const registeredCodeValid = Boolean(
    registeredAccess
    && registeredAccess.status === "active"
    && new Date(registeredAccess.expiresAt).getTime() > Date.now()
    && safeEqual(hashRegisteredGuestInviteCode(registeredAccess.id, code), registeredAccess.codeHash)
  );
  if (!registeredCodeValid && !safeEqual(code, getHourlyGuestChatCode(slug))) {
    return { ok: false as const, status: 401 as const, detail: "四位口令不正确，请向邀请人确认最新口令。" };
  }
  const room = await resolveGuestChatRoom(slug);
  if (!room) return { ok: false as const, status: 404 as const, detail: "这个群聊邀请已失效。" };

  const phoneLast4 = normalizedPhone.slice(-4);
  const identity: GuestChatIdentity = {
    id: `guest-${guestIdentityDigest(normalizedPhone).slice(0, 20)}`,
    displayName: `访客 ${phoneLast4}`,
    phoneLast4
  };
  const now = Math.floor(Date.now() / 1000);
  const session: GuestSession = { ...identity, exp: now + guestSessionMaxAgeSeconds, familyId: room.familyId, iat: now, recordId: room.id, slug };
  return { ok: true as const, identity, maxAge: guestSessionMaxAgeSeconds, room, token: createGuestSessionToken(session) };
}

export function getHourlyGuestChatCode(slug: string, now = new Date()) {
  const hourBucket = Math.floor(now.getTime() / 3_600_000);
  const digest = createHmac("sha256", guestCodeSecret()).update(`${slug}:${hourBucket}`).digest();
  return String(digest.readUInt32BE(0) % 10_000).padStart(4, "0");
}

export function guestCodeValidUntil(now = new Date()) {
  return new Date((Math.floor(now.getTime() / 3_600_000) + 1) * 3_600_000).toISOString();
}

export async function createRegisteredGuestInviteAccess(slug: string) {
  const room = await readRegisteredGuestRecord(slug);
  if (!room) return null;
  const code = String(randomInt(0, 10_000)).padStart(4, "0");
  const access: RegisteredGuestInviteAccess = {
    codeHash: "",
    expiresAt: new Date(Date.now() + guestSessionMaxAgeSeconds * 1000).toISOString(),
    id: randomUUID(),
    status: "active"
  };
  access.codeHash = hashRegisteredGuestInviteCode(access.id, code);
  await appendRegisteredGuestInvite({ access, room, slug });
  return { code, expiresAt: access.expiresAt, id: access.id, link: room.inviteLink };
}

export async function revokeRegisteredGuestInviteAccess(input: { familyId: string; id: string; slug: string }) {
  const room = await readRegisteredGuestRecord(input.slug);
  const access = await readRegisteredGuestInviteAccess(input.slug);
  if (!room || room.familyId !== input.familyId || !access || access.id !== input.id) return false;
  if (access.status !== "revoked") {
    await appendRegisteredGuestInvite({ access: { ...access, status: "revoked" }, room, slug: input.slug });
  }
  return true;
}

export function readGuestChatSession(request: Request, slug: string): GuestSession | null {
  const cookies = parseCookies(request.headers.get("cookie") || "");
  const session = verifyGuestSessionToken(cookies[guestCookieName(slug, true)] || cookies[guestCookieName(slug, false)] || "");
  return session?.slug === slug ? session : null;
}

export function guestSessionCookie(request: Request, token: string, slug: string, maxAge = guestSessionMaxAgeSeconds) {
  const secure = isSecureRequest(request);
  return { name: guestCookieName(slug, secure), value: token, options: { httpOnly: true, maxAge, path: "/", sameSite: "strict" as const, secure } };
}

export async function resolveGuestChatRoom(slug: string): Promise<GuestChatRoom | null> {
  const storedRecord = await readStoredGuestRecord(slug);
  const record = storedRecord || familyRecords.find((item) => item.inviteLink && getGuestChatSlug(item.inviteLink) === slug);
  if (!record?.inviteLink || getGuestChatSlug(record.inviteLink) !== slug) return null;
  const chatMembers = record.chatMembers || [];
  return {
    groupId: (record as FamilyRecord & { databaseGroupId?: string }).databaseGroupId || record.id,
    id: record.id,
    familyId: ("familyId" in record && typeof record.familyId === "string" ? record.familyId : "") || process.env.SUPABASE_DEFAULT_FAMILY_ID || "local-family",
    spaceId: record.spaceId,
    title: record.title,
    chatMembers,
    chatMessages: record.chatMessages || [],
    members: chatMembers.map((memberId) => familyMembers.find((member) => member.id === memberId)).filter((member): member is FamilyMember => Boolean(member)).map(({ id, displayName, avatarSeed, status }) => ({ id, displayName, avatarSeed, status }))
  };
}

async function readStoredGuestRecord(slug: string): Promise<(FamilyRecord & { familyId?: string }) | null> {
  const registeredRecord = await readRegisteredGuestRecord(slug);
  if (registeredRecord) return registeredRecord;
  const supabase = createServiceSupabaseClient();
  if (supabase) {
    const { data } = await supabase.from("family_records").select("id, family_id, space_id, title, metadata").eq("audience", "guest").order("updated_at", { ascending: false }).limit(500);
    const matched = (data || []).find((row) => {
      const metadata = readMetadata(row.metadata);
      return typeof metadata.inviteLink === "string" && getGuestChatSlug(metadata.inviteLink) === slug;
    });
    if (matched) {
      const metadata = readMetadata(matched.metadata);
      const clientRecordId = typeof (metadata as Partial<FamilyRecord> & { recordId?: unknown }).recordId === "string" ? (metadata as Partial<FamilyRecord> & { recordId: string }).recordId : "";
      return { ...metadata, databaseGroupId: matched.id, id: clientRecordId || matched.id, familyId: matched.family_id, spaceId: matched.space_id || metadata.spaceId, title: matched.title || metadata.title || "临时群聊", kind: metadata.kind || "note", summary: metadata.summary || "", ownerName: metadata.ownerName || "家人", status: metadata.status || "saved", tags: metadata.tags || ["群组"] } as FamilyRecord & { databaseGroupId?: string; familyId?: string };
    }
  }
  try {
    const content = await readFile("data/family-records.jsonl", "utf8");
    for (const line of content.trim().split(/\n+/).reverse()) {
      const parsed = JSON.parse(line) as { record?: FamilyRecord };
      if (parsed.record?.inviteLink && getGuestChatSlug(parsed.record.inviteLink) === slug) return parsed.record;
    }
  } catch {
    // The production path uses Supabase; a missing local fallback is expected.
  }
  return null;
}

export async function restoreAuthenticatedGuestChat(request: Request, slug: string) {
  const room = await resolveGuestChatRoom(slug);
  if (!room) return null;
  let identityUser;
  try {
    identityUser = await requireInviteUser(request);
  } catch {
    return null;
  }
  const service = createServiceSupabaseClient();
  if (!service) return null;
  const { data } = await service.from("group_members").select("display_name, avatar_url").eq("group_id", room.groupId).eq("user_id", identityUser.userId).eq("status", "active").maybeSingle();
  if (!data) return null;
  const now = Math.floor(Date.now() / 1000);
  const identity: GuestChatIdentity = { id: `guest-${identityUser.userId}`, displayName: data.display_name, phoneLast4: "" };
  const session: GuestSession = { ...identity, exp: now + guestSessionMaxAgeSeconds, familyId: room.familyId, iat: now, recordId: room.id, slug };
  return { identity, maxAge: guestSessionMaxAgeSeconds, room, token: createGuestSessionToken(session) };
}

async function readRegisteredGuestRecord(slug: string): Promise<(FamilyRecord & { familyId?: string }) | null> {
  try {
    const content = await readFile(guestInviteRegistryPath, "utf8");
    for (const line of content.trim().split(/\n+/).reverse()) {
      const row = JSON.parse(line) as { slug?: string; room?: Partial<FamilyRecord> & { familyId?: string; inviteLink?: string } };
      if (row.slug === slug && row.room?.id && row.room.inviteLink) {
        return { kind: "task", summary: "", ownerName: "家人", status: "todo", tags: ["群组"], ...row.room } as FamilyRecord & { familyId?: string };
      }
    }
  } catch {
    // The registry is created by the first external invitation.
  }
  return null;
}

async function readRegisteredGuestInviteAccess(slug: string): Promise<RegisteredGuestInviteAccess | null> {
  try {
    const content = await readFile(guestInviteRegistryPath, "utf8");
    for (const line of content.trim().split(/\n+/).reverse()) {
      const row = JSON.parse(line) as { access?: RegisteredGuestInviteAccess; slug?: string };
      if (row.slug === slug && row.access?.id) return row.access;
    }
  } catch {
    // Access rows are created only after the inviter explicitly creates an invite.
  }
  return null;
}

async function appendRegisteredGuestInvite(input: { access: RegisteredGuestInviteAccess; room: FamilyRecord & { familyId?: string }; slug: string }) {
  await mkdir("data", { recursive: true });
  await appendFile(guestInviteRegistryPath, `${JSON.stringify({ ...input, savedAt: new Date().toISOString() })}\n`, "utf8");
}

function hashRegisteredGuestInviteCode(id: string, code: string) {
  return createHmac("sha256", guestCodeSecret()).update(`registered:${id}:${code}`).digest("base64url");
}

function createGuestSessionToken(session: GuestSession) {
  const encoded = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

function verifyGuestSessionToken(token: string): GuestSession | null {
  const [encoded, providedSignature] = token.split(".");
  if (!encoded || !providedSignature || !safeEqual(providedSignature, sign(encoded))) return null;
  try {
    const session = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as GuestSession;
    return session.exp > Math.floor(Date.now() / 1000) && session.id.startsWith("guest-") ? session : null;
  } catch {
    return null;
  }
}

function guestIdentityDigest(phone: string) {
  return createHmac("sha256", guestSessionSecret()).update(`phone:${phone}`).digest("hex");
}
function sign(value: string) {
  return createHmac("sha256", guestSessionSecret()).update(value).digest("base64url");
}
function guestSessionSecret() {
  return process.env.GUEST_CHAT_SESSION_SECRET || process.env.FAMILY_APP_LOCAL_AUTH_SESSION_SECRET || process.env.FAMILY_APP_CONFIRMATION_SECRET || "family-app-local-guest-secret";
}
function guestCodeSecret() {
  return process.env.GUEST_CHAT_CODE_SECRET || guestSessionSecret();
}
function guestCookieName(slug: string, secure: boolean) {
  const suffix = createHmac("sha256", guestSessionSecret()).update(`room:${slug}`).digest("hex").slice(0, 12);
  return `${secure ? "__Host-" : ""}family_guest_${suffix}`;
}
function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
function parseCookies(header: string) {
  return Object.fromEntries(header.split(";").map((part) => part.trim().split("=")).filter(([name, value]) => Boolean(name && value)).map(([name, ...value]) => [name, value.join("=")]));
}
function isSecureRequest(request: Request) {
  return request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https" || new URL(request.url).protocol === "https:";
}
function readMetadata(value: unknown): Partial<FamilyRecord> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Partial<FamilyRecord> : {};
}
