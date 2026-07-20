import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const configuredSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const configuredPublicSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_URL;
const configuredLanPort = process.env.NEXT_PUBLIC_SUPABASE_LAN_PORT || "8000";

export type FamilySupabaseClient = SupabaseClient<Database>;

function readSupabaseConfig(): { url: string; anonKey: string } | null {
  const url = readBrowserSupabaseUrl();
  if (!url || !supabaseAnonKey) {
    return null;
  }

  return { url, anonKey: supabaseAnonKey };
}

function readBrowserSupabaseUrl() {
  if (typeof window === "undefined") {
    return configuredSupabaseUrl || configuredPublicSupabaseUrl || "";
  }

  const hostname = window.location.hostname;
  if (isLanHostname(hostname)) {
    const host = hostname.includes(":") ? `[${hostname}]` : hostname;
    return `${window.location.protocol}//${host}:${configuredLanPort}`;
  }

  return configuredPublicSupabaseUrl || configuredSupabaseUrl || "";
}

function isLanHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  if (normalized === "localhost" || normalized === "::1" || normalized.endsWith(".local") || normalized.startsWith("127.")) return true;
  if (/^10\./.test(normalized) || /^192\.168\./.test(normalized)) return true;
  const private172 = normalized.match(/^172\.(\d{1,3})\./);
  return private172 ? Number(private172[1]) >= 16 && Number(private172[1]) <= 31 : false;
}

export function hasSupabaseConfig(): boolean {
  return readSupabaseConfig() !== null;
}

export function createBrowserSupabaseClient(): FamilySupabaseClient | null {
  const config = readSupabaseConfig();

  if (!config) {
    return null;
  }

  return createClient<Database>(config.url, config.anonKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
      storageKey: "family-app.auth-session"
    }
  });
}

export const supabase = createBrowserSupabaseClient();
