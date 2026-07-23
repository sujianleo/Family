export type FamilyBackend = "sqlite" | "supabase";

export function readFamilyBackend(): FamilyBackend {
  const configured = process.env.FAMILY_APP_BACKEND?.trim().toLowerCase();
  if (configured === "lite" || configured === "sqlite") return "sqlite";
  if (configured === "full" || configured === "supabase") return "supabase";
  if (configured) throw new Error(`不支持的 FAMILY_APP_BACKEND: ${configured}`);

  // Preserve the existing deployment contract. Lite mode must be selected
  // explicitly so a missing Supabase secret never silently changes storage.
  return "supabase";
}

export function isLiteBackend() {
  return readFamilyBackend() === "sqlite";
}
