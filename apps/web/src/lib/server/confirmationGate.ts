import { createHmac, timingSafeEqual } from "node:crypto";

type ConfirmationPayload = {
  actionId?: string;
  actorMemberId: string;
  expiresAt: number;
  inputHash: string;
  pipelineId?: string;
};

export type ConfirmationRequest = Omit<ConfirmationPayload, "expiresAt" | "inputHash"> & {
  parameters: Record<string, unknown>;
};

export function issueConfirmationToken(request: ConfirmationRequest) {
  const payload: ConfirmationPayload = {
    actionId: request.actionId,
    actorMemberId: request.actorMemberId,
    expiresAt: Date.now() + 10 * 60 * 1000,
    inputHash: hashParameters(request.parameters),
    pipelineId: request.pipelineId
  };
  const encodedPayload = encode(payload);
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifyConfirmationToken(token: string, request: ConfirmationRequest) {
  const [encodedPayload, signature, ...rest] = token.split(".");
  if (!encodedPayload || !signature || rest.length) {
    return false;
  }

  const expected = sign(encodedPayload);
  if (!safeEqual(signature, expected)) {
    return false;
  }

  const payload = decode(encodedPayload);
  return Boolean(
    payload &&
      payload.expiresAt > Date.now() &&
      payload.actorMemberId === request.actorMemberId &&
      payload.actionId === request.actionId &&
      payload.pipelineId === request.pipelineId &&
      payload.inputHash === hashParameters(request.parameters)
  );
}

function sign(value: string) {
  const secret = process.env.FAMILY_APP_CONFIRMATION_SECRET;
  if (!secret) {
    throw new Error("缺少 FAMILY_APP_CONFIRMATION_SECRET，无法执行需要确认的动作。");
  }
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function hashParameters(value: Record<string, unknown>) {
  return createHmac("sha256", confirmationHashKey()).update(stableJson(value)).digest("hex");
}

function confirmationHashKey() {
  return process.env.FAMILY_APP_CONFIRMATION_SECRET || "missing-confirmation-secret";
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function encode(value: ConfirmationPayload) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decode(value: string): ConfirmationPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<ConfirmationPayload>;
    return typeof parsed.actorMemberId === "string" && typeof parsed.expiresAt === "number" && typeof parsed.inputHash === "string" ? (parsed as ConfirmationPayload) : null;
  } catch {
    return null;
  }
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
