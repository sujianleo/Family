import { NextResponse } from "next/server";
import { normalizePhoneNumber } from "@/lib/phoneAuth";
import { readLiteAccounts, readLiteInstallation, saveLiteFamilyRecord } from "@/lib/server/liteRepository";
import type { FamilyRecord } from "@/lib/types";

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

  const installation = readLiteInstallation();
  if (!installation) {
    return NextResponse.json({ detail: "家庭注册服务尚未配置。" }, { status: 503 });
  }
  const adminMemberId = readLiteAccounts().find(
    (account) => account.familyId === installation.familyId && account.role === "admin"
  )?.memberId || "";

  const id = crypto.randomUUID();
  const task = buildRegistrationTask(id, phone, adminMemberId);
  saveLiteFamilyRecord(installation.familyId, adminMemberId || "me", task);

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

function rateLimited(key: string, limit: number) {
  const now = Date.now();
  const recent = (attempts.get(key) || []).filter((time) => now - time < windowMs);
  attempts.set(key, recent);
  return recent.length >= limit;
}

function recordAttempt(key: string) {
  attempts.set(key, [...(attempts.get(key) || []), Date.now()]);
}
