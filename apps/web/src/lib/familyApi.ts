export async function familyFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  return fetch(input, init);
}

export function isFamilyAuthRequired() {
  return process.env.NEXT_PUBLIC_FAMILY_APP_AUTH_REQUIRED !== "false";
}

export function isLocalFamilyAuth() {
  return true;
}
