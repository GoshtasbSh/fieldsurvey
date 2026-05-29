"use client";

import { usePresence } from "@/lib/realtime/use-presence";

export type MemberRow = {
  user_id: string;
  role: string;
  joined_at: string;
  profiles: {
    email: string | null;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
};

/**
 * Renders one row per member with a green presence dot when the user is
 * online right now. Locked Q5: ephemeral only — no `last_seen_at`.
 *
 * Edit / remove forms live in the parent server-component page so they can
 * use server actions directly. This client component is read-only chrome
 * around them via a `children` slot per row.
 */
export function MembersList({
  projectId,
  currentUserId,
  members,
  rowActions,
}: {
  projectId: string;
  currentUserId: string | null;
  members: MemberRow[];
  /** Map of member.user_id → React node rendered at the right side of the row. */
  rowActions: Record<string, React.ReactNode>;
}) {
  const online = usePresence(projectId, currentUserId);

  return (
    <div className="space-y-2">
      {members.map((m) => {
        const isMe = m.user_id === currentUserId;
        const isOnline = online.has(m.user_id);
        return (
          <div key={m.user_id} className="bento-panel p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="relative flex-shrink-0">
                  <div
                    className="h-9 w-9 rounded-full"
                    style={{
                      background:
                        "linear-gradient(135deg, var(--bento-magenta), var(--bento-accent))",
                    }}
                  />
                  {/* Presence dot */}
                  <span
                    className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full transition"
                    style={{
                      background: isOnline ? "var(--bento-success)" : "var(--bento-ink-4)",
                      boxShadow: `0 0 0 2px var(--bento-surface)${
                        isOnline ? ", 0 0 6px var(--bento-success)" : ""
                      }`,
                    }}
                    title={isOnline ? "Online now" : "Offline"}
                    aria-label={isOnline ? "Online now" : "Offline"}
                  />
                </div>
                <div className="min-w-0">
                  <div className="flex items-baseline gap-1.5">
                    <span className="truncate text-[13.5px] font-semibold text-[var(--bento-ink-1)]">
                      {m.profiles?.display_name || m.profiles?.email || "Unknown"}
                    </span>
                    {isMe && (
                      <span className="bento-chip" style={{ fontSize: "9.5px", padding: "1px 6px" }}>
                        you
                      </span>
                    )}
                    {isOnline && (
                      <span
                        className="text-[10px] font-semibold"
                        style={{ color: "var(--bento-success)" }}
                      >
                        ● online
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[11px] text-[var(--bento-ink-3)]">
                    {m.profiles?.email}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">{rowActions[m.user_id] ?? null}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
