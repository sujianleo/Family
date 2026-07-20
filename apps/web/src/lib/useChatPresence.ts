"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export function useChatPresence(roomId: string, identityId: string, enabled = true) {
  const [onlineMemberIds, setOnlineMemberIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!enabled || !roomId || !identityId) {
      setOnlineMemberIds(new Set());
      return;
    }
    if (!supabase) {
      setOnlineMemberIds(new Set([identityId]));
      return;
    }

    const client = supabase as any;
    const channel = client.channel(`family-chat-presence:${roomId}`, { config: { presence: { key: identityId } } });
    const syncPresence = () => {
      const nextIds = new Set<string>();
      const state = channel.presenceState() as Record<string, Array<{ memberId?: string }>>;
      Object.values(state).flat().forEach((presence) => {
        if (presence.memberId) nextIds.add(presence.memberId);
      });
      nextIds.add(identityId);
      setOnlineMemberIds(nextIds);
    };

    channel
      .on("presence", { event: "sync" }, syncPresence)
      .on("presence", { event: "join" }, syncPresence)
      .on("presence", { event: "leave" }, syncPresence)
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") {
          void channel.track({ memberId: identityId, onlineAt: new Date().toISOString() });
          syncPresence();
        }
      });

    setOnlineMemberIds(new Set([identityId]));
    return () => {
      void channel.untrack();
      void client.removeChannel(channel);
    };
  }, [enabled, identityId, roomId]);

  return onlineMemberIds;
}
