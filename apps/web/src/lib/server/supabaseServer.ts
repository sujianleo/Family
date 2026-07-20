import { createClient } from "@supabase/supabase-js";
import { readSupabaseServerUrl } from "./supabaseConfig";

export function createServiceSupabaseClient() {
  const supabaseUrl = readSupabaseServerUrl();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false }
  });
}
