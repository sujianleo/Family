import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export type FamilySupabaseClient = SupabaseClient<Database>;

function readSupabaseConfig(): { url: string; anonKey: string } | null {
  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  return { url: supabaseUrl, anonKey: supabaseAnonKey };
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
