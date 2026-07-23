"use client";

import { useMemo } from "react";

export function useChatPresence(roomId: string, identityId: string, enabled = true) {
  return useMemo(
    () => enabled && roomId && identityId ? new Set([identityId]) : new Set<string>(),
    [enabled, identityId, roomId]
  );
}
