/**
 * Compatibility boundary for older optional-store branches.
 *
 * The single-container edition persists data locally, so no external store
 * client is configured. Callers fall back to SQLite or files in /app/data.
 */
export function createServiceExternalStoreClient(): any | null {
  return null;
}
