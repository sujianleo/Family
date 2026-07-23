export type FamilyBackend = "sqlite";

export function readFamilyBackend(): FamilyBackend {
  const configured = process.env.FAMILY_APP_BACKEND?.trim().toLowerCase();
  if (!configured || configured === "lite" || configured === "sqlite") return "sqlite";
  throw new Error(`不支持的 FAMILY_APP_BACKEND: ${configured}`);
}

export function isLiteBackend() {
  return true;
}
