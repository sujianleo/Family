import { createClient } from "@supabase/supabase-js";
import { createServiceSupabaseClient } from "./supabaseServer";
import { isLocalAuthConfigured, localAuthContext, readLocalSession } from "./localAuth";
import { readRemovedMemberIds } from "./memberOverrides";

export type FamilyRequestContext = {
  familyId: string;
  memberId: string;
  userId: string;
};

export class FamilyRequestContextError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 | 503
  ) {
    super(message);
  }
}

export async function requireFamilyRequestContext(request: Request): Promise<FamilyRequestContext> {
  if (isLocalAuthConfigured()) {
    const session = readLocalSession(request);
    if (session) {
      const removedMemberIds = await readRemovedMemberIds("data");
      if (removedMemberIds.includes(session.memberId)) {
        throw new FamilyRequestContextError("该账号已不在家庭中。", 403);
      }
      return localAuthContext(session);
    }
    throw new FamilyRequestContextError("请先登录家庭账号。", 401);
  }
  if (!isFamilyAuthRequired() || isTrustedLocalRequest(request)) {
    return {
      familyId: process.env.SUPABASE_DEFAULT_FAMILY_ID || "local-family",
      memberId: process.env.SUPABASE_DEFAULT_MEMBER_ID || "me",
      userId: "local-development"
    };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = createServiceSupabaseClient();
  if (!url || !anonKey || !service) {
    throw new FamilyRequestContextError("家庭访问鉴权尚未配置。", 503);
  }

  const token = readBearerToken(request.headers.get("authorization"));
  if (!token) {
    throw new FamilyRequestContextError("请先登录家庭账号。", 401);
  }

  const authClient = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) {
    throw new FamilyRequestContextError("登录会话无效或已过期。", 401);
  }

  const selectedFamilyId = readFamilyContextId(request.headers.get("x-family-context-id")) || readFamilyContextId(process.env.SUPABASE_DEFAULT_FAMILY_ID || "");
  let memberQuery = service
    .from("family_members")
    .select("id, family_id")
    .eq("user_id", data.user.id);
  if (selectedFamilyId) memberQuery = memberQuery.eq("family_id", selectedFamilyId);
  const { data: memberships, error: memberError } = await memberQuery.limit(2);
  if (memberError) {
    throw new FamilyRequestContextError("无法确认家庭成员身份。", 503);
  }
  if (!selectedFamilyId && (memberships || []).length > 1) {
    throw new FamilyRequestContextError("请选择要进入的家庭。", 403);
  }
  const member = memberships?.[0];
  if (!member?.id || !member.family_id) {
    throw new FamilyRequestContextError("该登录账号尚未加入家庭。", 403);
  }

  return {
    familyId: member.family_id,
    memberId: member.id,
    userId: data.user.id
  };
}

function readFamilyContextId(value: string | null | undefined) {
  const trimmed = value?.trim() || "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed) ? trimmed : "";
}

function isTrustedLocalRequest(request: Request) {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const hostHeader = forwardedHost || request.headers.get("host") || new URL(request.url).host;
  const hostname = hostHeader.replace(/^\[/, "").replace(/\](:\d+)?$/, "").replace(/:\d+$/, "").toLowerCase();
  if (hostname === "localhost" || hostname === "::1" || hostname === "[::1]" || hostname.startsWith("127.")) {
    return true;
  }
  if (/^10\./.test(hostname) || /^192\.168\./.test(hostname)) {
    return true;
  }
  const private172 = hostname.match(/^172\.(\d{1,3})\./);
  return private172 ? Number(private172[1]) >= 16 && Number(private172[1]) <= 31 : false;
}

export function isFamilyAuthRequired() {
  if (process.env.FAMILY_APP_AUTH_REQUIRED === "true") {
    return true;
  }
  if (process.env.FAMILY_APP_AUTH_REQUIRED === "false") {
    return false;
  }
  return process.env.NODE_ENV === "production";
}

function readBearerToken(value: string | null) {
  if (!value) {
    return "";
  }
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}
