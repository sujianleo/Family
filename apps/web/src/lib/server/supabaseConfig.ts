export function readSupabaseServerUrl() {
  return process.env.SUPABASE_INTERNAL_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
}

export function readSupabaseAnonKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || "";
}

