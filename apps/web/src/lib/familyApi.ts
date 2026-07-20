import { supabase } from "./supabase";

export async function familyFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;

  if (session?.access_token) {
    headers.set("authorization", `Bearer ${session.access_token}`);
  }
  const selectedFamilyId = process.env.NEXT_PUBLIC_SUPABASE_FAMILY_ID;
  if (selectedFamilyId) headers.set("x-family-context-id", selectedFamilyId);

  return fetch(input, {
    ...init,
    headers
  });
}

export function isFamilyAuthRequired() {
  return process.env.NEXT_PUBLIC_FAMILY_APP_AUTH_REQUIRED === "true";
}

export function isLocalFamilyAuth() {
  return process.env.NEXT_PUBLIC_FAMILY_APP_AUTH_PROVIDER === "local";
}
