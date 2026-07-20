import { appendFile, mkdir } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { normalizePhoneNumber } from "@/lib/phoneAuth";
import { readSupabaseServerUrl } from "@/lib/server/supabaseConfig";
import type { Database, FamilyRecord, Json } from "@/lib/types";

export const runtime = "nodejs";

const windowMs = 15 * 60_000;
const attempts = new Map<string, number[]>();

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ detail: "请求格式不正确。" }, { status: 415 });
  }

  const body = await request.json().catch(() => ({})) as { phone?: unknown };
  const phone = normalizePhoneNumber(typeof body.phone === "string" ? body.phone : "");
  if (!phone) {
    return NextResponse.json({ detail: "请输入正确的手机号。" }, { status: 400 });
  }

  const ip = clientIp(request);
  if (rateLimited(`ip:${ip}`, 5) || rateLimited(`phone:${phone}`, 2)) {
    return NextResponse.json({ detail: "申请次数过多，请稍后再试。" }, { status: 429 });
  }

  const supabaseUrl = readSupabaseServerUrl();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const usesSupabase = Boolean(supabaseUrl && serviceRoleKey);
  const configuredFamilyId = process.env.FAMILY_APP_LOCAL_AUTH_FAMILY_ID || process.env.SUPABASE_DEFAULT_FAMILY_ID || "";
  const configuredAdminMemberId = process.env.FAMILY_APP_LOCAL_AUTH_MEMBER_ID || process.env.SUPABASE_DEFAULT_MEMBER_ID || "";
  const familyId = usesSupabase
    ? normalizeUuid(process.env.FAMILY_APP_LOCAL_AUTH_FAMILY_ID || "") || normalizeUuid(process.env.SUPABASE_DEFAULT_FAMILY_ID || "")
    : configuredFamilyId;
  const adminMemberId = usesSupabase
    ? normalizeUuid(process.env.FAMILY_APP_LOCAL_AUTH_MEMBER_ID || "") || normalizeUuid(process.env.SUPABASE_DEFAULT_MEMBER_ID || "")
    : configuredAdminMemberId;
  if (!familyId) {
    return NextResponse.json({ detail: "家庭注册服务尚未配置。" }, { status: 503 });
  }

  const id = crypto.randomUUID();
  const task = buildRegistrationTask(id, phone, adminMemberId);

  if (usesSupabase && supabaseUrl && serviceRoleKey) {
    const supabase = createClient<Database>(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { error } = await supabase.from("family_records").insert({
      id,
      family_id: familyId,
      member_id: null,
      space_id: null,
      created_by_member_id: null,
      assignee_member_ids: task.assigneeMemberIds || [],
      audience: "core",
      assignment_status: "assigned",
      assignment_reason: task.assignmentReason || "",
      kind: "task",
      title: task.title,
      summary: task.summary,
      status: "todo",
      tags: task.tags,
      metadata: toJson(task)
    });
    if (error) {
      return NextResponse.json({ detail: "注册申请发送失败，请稍后重试。" }, { status: 500 });
    }
  } else {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ detail: "家庭注册存储尚未配置。" }, { status: 503 });
    }
    await mkdir("data", { recursive: true });
    await appendFile("data/family-records.jsonl", `${JSON.stringify({ record: task, savedAt: new Date().toISOString() })}\n`, "utf8");
  }

  recordAttempt(`ip:${ip}`);
  recordAttempt(`phone:${phone}`);
  return NextResponse.json({ id, status: "pending_admin_approval" }, { status: 202 });
}

function buildRegistrationTask(id: string, phone: string, adminMemberId: string): FamilyRecord {
  return {
    id,
    kind: "task",
    title: `审核注册申请 · ${maskPhone(phone)}`,
    summary: `申请账户：${phone}\n请家庭管理员审核是否允许注册。`,
    ownerName: "注册申请",
    assigneeMemberIds: adminMemberId ? [adminMemberId] : [],
    audience: "core",
    assignmentStatus: "assigned",
    assignmentReason: "新成员注册申请",
    status: "todo",
    updatedAt: "刚刚",
    tags: ["注册申请", "待审核"]
  };
}

function maskPhone(phone: string) {
  return phone.replace(/(\d{3})\d+(\d{4})$/, "$1****$2");
}

function clientIp(request: Request) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function normalizeUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : "";
}

function rateLimited(key: string, limit: number) {
  const now = Date.now();
  const recent = (attempts.get(key) || []).filter((time) => now - time < windowMs);
  attempts.set(key, recent);
  return recent.length >= limit;
}

function recordAttempt(key: string) {
  attempts.set(key, [...(attempts.get(key) || []), Date.now()]);
}

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}
