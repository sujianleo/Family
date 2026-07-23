const defaultPublicGuestChatBaseUrl = "http://localhost:3000";

type GuestChatLinkOptions = {
  baseUrl?: string;
  randomBytes?: (length: number) => Uint8Array;
};

type GuestChatEnv = {
  APP_BASE_URL?: string;
  FAMILY_PUBLIC_URL?: string;
  NEXT_PUBLIC_APP_URL?: string;
};

export function getConfiguredGuestChatBaseUrl(env: GuestChatEnv = readGuestChatEnv()): string {
  const configuredUrl = env.NEXT_PUBLIC_APP_URL || env.FAMILY_PUBLIC_URL || env.APP_BASE_URL || defaultPublicGuestChatBaseUrl;
  return normalizeGuestChatBaseUrl(configuredUrl);
}

export function createGuestChatLink(options: GuestChatLinkOptions = {}): string {
  const baseUrl = normalizeGuestChatBaseUrl(options.baseUrl || getConfiguredGuestChatBaseUrl());
  return `${baseUrl}/guest/chat/${createOpaqueGuestChatToken(options.randomBytes)}`;
}

export function getGuestChatSlug(link: string): string {
  try {
    const url = new URL(link);
    const parts = url.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] || "chat";
  } catch {
    const parts = link.split("?")[0].split("/").filter(Boolean);
    return parts[parts.length - 1] || "chat";
  }
}

export function getGuestChatCode(slug: string): string {
  let hash = 0;

  for (const char of slug) {
    hash = (hash * 31 + char.charCodeAt(0)) % 10000;
  }

  return String(hash).padStart(4, "0");
}

export function formatGuestInviteClipboardText(link: string): string {
  const code = getGuestChatCode(getGuestChatSlug(link));
  return `加密链接：${link}\n口令：${code}`;
}

function normalizeGuestChatBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim() || defaultPublicGuestChatBaseUrl;
  return trimmed.replace(/\/+$/, "");
}

function readGuestChatEnv(): GuestChatEnv {
  if (typeof process === "undefined") {
    return {};
  }

  return {
    APP_BASE_URL: process.env.APP_BASE_URL,
    FAMILY_PUBLIC_URL: process.env.FAMILY_PUBLIC_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL
  };
}

function createOpaqueGuestChatToken(randomBytes?: (length: number) => Uint8Array): string {
  const bytes = randomBytes ? randomBytes(18) : readRandomBytes(18);
  return base64UrlEncode(bytes);
}

function readRandomBytes(length: number): Uint8Array {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    return crypto.getRandomValues(new Uint8Array(length));
  }

  return Uint8Array.from({ length }, () => Math.floor(Math.random() * 256));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  const base64 = typeof btoa === "function"
    ? btoa(binary)
    : Buffer.from(bytes).toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
