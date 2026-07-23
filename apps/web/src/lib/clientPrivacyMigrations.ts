const migrationMarkerKey = "family-app.privacy.network-addresses-cleared.v1";
const settingsStorageKey = "family-app.settings.v1";
const onboardingStorageKey = "family-app.onboarding.v1";

export function clearStoredNetworkAddressesOnce(storage: Storage) {
  if (storage.getItem(migrationMarkerKey) === "1") return;

  rewriteStoredObject(storage, settingsStorageKey, (settings) => {
    delete settings.lanIp;
    if (settings.activeNetwork === "local") settings.activeNetwork = null;
    if (settings.networkMode === "local") settings.networkMode = "auto";
  });
  rewriteStoredObject(storage, onboardingStorageKey, (onboarding) => {
    delete onboarding.lanAddress;
  });

  storage.setItem(migrationMarkerKey, "1");
}

function rewriteStoredObject(storage: Storage, key: string, rewrite: (value: Record<string, unknown>) => void) {
  const rawValue = storage.getItem(key);
  if (!rawValue) return;

  try {
    const value = JSON.parse(rawValue) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      storage.removeItem(key);
      return;
    }
    const record = value as Record<string, unknown>;
    rewrite(record);
    storage.setItem(key, JSON.stringify(record));
  } catch {
    storage.removeItem(key);
  }
}
