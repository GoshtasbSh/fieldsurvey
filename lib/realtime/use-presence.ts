"use client";

import { useEffect, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/client";

/**
 * Singleton Realtime presence hook.
 *
 * Locked Q5 decision: ephemeral only — green dot = online right now, no
 * `last_seen_at` persistence. We reuse the SAME channel name the chat panel
 * subscribes to (`chat:${projectId}`) so the members page presence and the
 * chat-panel presence are coherent without duplicating WebSocket subscriptions.
 *
 * Multiple components calling `usePresence(projectId)` share one Supabase
 * channel per project — keyed by projectId in module scope.
 */

type PresenceMeta = { user_id: string; online_at: string };
type Channel = ReturnType<ReturnType<typeof createBrowserSupabase>["channel"]>;

type ChannelEntry = {
  channel: Channel;
  refCount: number;
  listeners: Set<(online: Set<string>) => void>;
  online: Set<string>;
};

const channels = new Map<string, ChannelEntry>();

function getOrCreateChannel(projectId: string, currentUserId: string | null): ChannelEntry {
  const key = projectId;
  const existing = channels.get(key);
  if (existing) return existing;

  const sb = createBrowserSupabase();
  const channel = sb.channel(`chat:${projectId}`, {
    config: { presence: { key: currentUserId ?? `anon-${Math.random().toString(36).slice(2)}` } },
  });

  const entry: ChannelEntry = {
    channel,
    refCount: 0,
    listeners: new Set(),
    online: new Set(),
  };

  channel.on("presence", { event: "sync" }, () => {
    const state = channel.presenceState() as Record<string, PresenceMeta[]>;
    const next = new Set<string>();
    for (const metas of Object.values(state)) {
      for (const meta of metas) {
        if (meta?.user_id) next.add(meta.user_id);
      }
    }
    entry.online = next;
    for (const cb of entry.listeners) cb(next);
  });

  channel.subscribe(async (status) => {
    if (status === "SUBSCRIBED" && currentUserId) {
      await channel.track({ user_id: currentUserId, online_at: new Date().toISOString() });
    }
  });

  channels.set(key, entry);
  return entry;
}

export function usePresence(projectId: string, currentUserId: string | null): Set<string> {
  const [online, setOnline] = useState<Set<string>>(new Set());

  useEffect(() => {
    const entry = getOrCreateChannel(projectId, currentUserId);
    entry.refCount += 1;
    const listener = (next: Set<string>) => setOnline(new Set(next));
    entry.listeners.add(listener);
    // Sync initial state from any existing subscriber.
    setOnline(new Set(entry.online));

    return () => {
      entry.listeners.delete(listener);
      entry.refCount -= 1;
      if (entry.refCount <= 0) {
        try {
          entry.channel.unsubscribe();
        } catch {
          /* ignore */
        }
        channels.delete(projectId);
      }
    };
  }, [projectId, currentUserId]);

  return online;
}
