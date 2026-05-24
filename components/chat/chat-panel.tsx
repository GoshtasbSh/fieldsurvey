"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Send } from "lucide-react";
import { createBrowserSupabase } from "@/lib/supabase/client";
import type { ChatMessage } from "@/lib/queries/chat";

type Member = { user_id: string; display_name: string; email: string; avatar_url: string | null };
type Presence = { user_id: string; online_at: string };

type Props = {
  projectId: string;
  currentUserId: string;
  members: Member[];
  initial: ChatMessage[];
};

/**
 * Chat panel — used inside the Team tab on both desktop and mobile.
 * Realtime subscribes to chat_messages for the project and to a presence
 * channel for "X surveyors online" green dots.
 */
export function ChatPanel({ projectId, currentUserId, members, initial }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>(initial);
  const [body, setBody] = useState("");
  const [presence, setPresence] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [mentionAnchor, setMentionAnchor] = useState<{ start: number; query: string } | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const sb = useMemo(() => createBrowserSupabase(), []);

  const memberByName = useMemo(() => {
    const m = new Map<string, Member>();
    for (const x of members) m.set(x.display_name.toLowerCase(), x);
    return m;
  }, [members]);

  // Realtime: chat + presence
  useEffect(() => {
    const channel = sb.channel(`chat:${projectId}`, { config: { presence: { key: currentUserId } } });

    channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `project_id=eq.${projectId}` }, (payload) => {
      const row = payload.new as ChatMessage;
      const author = members.find((m) => m.user_id === row.author_id);
      setMessages((prev) => {
        if (prev.some((m) => m.id === row.id)) return prev;
        return [...prev, { ...row, author: author ? { display_name: author.display_name, email: author.email, avatar_url: author.avatar_url } : undefined }];
      });
    });
    channel.on("postgres_changes", { event: "DELETE", schema: "public", table: "chat_messages", filter: `project_id=eq.${projectId}` }, (payload) => {
      const old = payload.old as { id: string };
      setMessages((prev) => prev.filter((m) => m.id !== old.id));
    });

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState() as Record<string, Presence[]>;
      setPresence(new Set(Object.keys(state)));
    });

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ user_id: currentUserId, online_at: new Date().toISOString() });
      }
    });

    return () => {
      void sb.removeChannel(channel);
    };
  }, [sb, projectId, currentUserId, members]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const s = scrollerRef.current;
    if (s) s.scrollTop = s.scrollHeight;
  }, [messages.length]);

  // @mention detection while typing
  function onBodyChange(value: string, caret: number) {
    setBody(value);
    const before = value.slice(0, caret);
    const m = before.match(/(?:^|\s)@(\w*)$/);
    if (m) setMentionAnchor({ start: caret - m[1].length, query: m[1].toLowerCase() });
    else setMentionAnchor(null);
  }

  function applyMention(member: Member) {
    if (!mentionAnchor) return;
    const before = body.slice(0, mentionAnchor.start);
    const after = body.slice(mentionAnchor.start + mentionAnchor.query.length);
    const display = member.display_name.replace(/\s+/g, "");
    setBody(`${before}${display} ${after}`);
    setMentionAnchor(null);
  }

  async function send() {
    const trimmed = body.trim();
    if (!trimmed) return;
    setSending(true);
    // Resolve @mentions in the text to user_ids
    const mentions: string[] = [];
    for (const match of trimmed.matchAll(/@([\w]+)/g)) {
      const m = memberByName.get(match[1].toLowerCase());
      if (m) mentions.push(m.user_id);
    }
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project_id: projectId, body: trimmed, mentions: [...new Set(mentions)] }),
      });
      if (!r.ok) throw new Error(await r.text());
      setBody("");
    } finally {
      setSending(false);
    }
  }

  const mentionSuggestions = mentionAnchor
    ? members.filter((m) => m.display_name.toLowerCase().includes(mentionAnchor.query)).slice(0, 5)
    : [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* presence strip */}
      <div className="flex items-center gap-2 border-b border-[var(--shell-border)] bg-[var(--shell-2)] px-3 py-2 text-[11px] text-[var(--shell-text-muted)]">
        <span className="relative h-2 w-2 rounded-full bg-[oklch(76%_0.16_158)]" />
        {presence.size} online ·
        <div className="flex -space-x-1.5">
          {members.filter((m) => presence.has(m.user_id)).slice(0, 5).map((m) => (
            <div key={m.user_id} title={m.display_name} className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[var(--shell-2)] bg-gradient-to-br from-[oklch(72%_0.18_305)] to-[oklch(78%_0.155_234)] text-[8px] font-bold text-[var(--shell-base)]">
              {initials(m.display_name)}
            </div>
          ))}
        </div>
      </div>

      {/* messages */}
      <div ref={scrollerRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2.5">
        {messages.length === 0 && <p className="text-center text-[11.5px] text-[var(--shell-text-muted)]">No messages yet. Say hi.</p>}
        {messages.map((m) => {
          const mine = m.author_id === currentUserId;
          const name = m.author?.display_name || m.author?.email?.split("@")[0] || "Member";
          return (
            <div key={m.id} className={`flex gap-2 ${mine ? "flex-row-reverse" : "flex-row"}`}>
              <div className={`inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-[var(--shell-base)] ${presence.has(m.author_id) ? "ring-2 ring-[oklch(76%_0.16_158)]" : ""}`} style={{ background: gradFromId(m.author_id) }}>
                {initials(name)}
              </div>
              <div className={`max-w-[78%] rounded-2xl px-3 py-2 text-[12.5px] leading-relaxed ${mine ? "bg-[oklch(78%_0.155_234/0.18)] text-[var(--shell-text)]" : "bg-[var(--shell-2)] text-[var(--shell-text)]"}`}>
                <div className={`mb-0.5 flex items-baseline gap-2 ${mine ? "justify-end" : ""}`}>
                  <span className="font-display text-[11px] font-bold text-[var(--shell-text)]">{name}</span>
                  <span className="font-mono text-[9.5px] text-[var(--shell-text-muted)]">{relTime(m.created_at)}</span>
                </div>
                <div dangerouslySetInnerHTML={{ __html: highlightMentions(escapeHtml(m.body), members) }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* composer */}
      <div className="relative border-t border-[var(--shell-border)] bg-[var(--shell-1)] p-2">
        {mentionSuggestions.length > 0 && (
          <div className="absolute bottom-full left-2 right-2 mb-1 rounded-lg border border-[var(--shell-border)] bg-[var(--shell-1)] shadow-[0_8px_24px_-8px_oklch(0%_0_0/0.5)]">
            {mentionSuggestions.map((m) => (
              <button
                key={m.user_id}
                onClick={() => applyMention(m)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-[var(--shell-2)]"
              >
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-[var(--shell-base)]" style={{ background: gradFromId(m.user_id) }}>{initials(m.display_name)}</span>
                <span>{m.display_name}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={body}
            onChange={(e) => onBodyChange(e.target.value, e.target.selectionStart)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
            placeholder="Message your team…  use @ to mention"
            rows={1}
            className="flex-1 max-h-32 resize-none rounded-lg border border-[var(--shell-border)] bg-[var(--shell-2)] px-3 py-2 text-[13px] outline-none focus:border-[oklch(78%_0.155_234/0.5)]"
          />
          <button
            onClick={send}
            disabled={sending || !body.trim()}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[oklch(78%_0.155_234)] text-[var(--shell-base)] shadow-[0_4px_14px_oklch(78%_0.155_234/0.4)] disabled:opacity-50 transition"
            aria-label="Send"
          >
            <Send className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
}

function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).filter(Boolean).join("").slice(0, 2).toUpperCase();
}
function gradFromId(id: string): string {
  const hash = [...id].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 0);
  const h1 = 200 + (hash % 120);
  const h2 = (h1 + 60) % 360;
  return `linear-gradient(135deg, oklch(72% 0.16 ${h1}), oklch(78% 0.155 ${h2}))`;
}
function relTime(iso: string): string {
  const t = Date.now() - new Date(iso).getTime();
  if (t < 60_000) return "now";
  if (t < 3_600_000) return `${Math.floor(t / 60_000)}m`;
  if (t < 86_400_000) return `${Math.floor(t / 3_600_000)}h`;
  return new Date(iso).toLocaleDateString();
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}
function highlightMentions(text: string, members: Member[]): string {
  const names = new Set(members.map((m) => m.display_name.replace(/\s+/g, "")));
  return text.replace(/@(\w+)/g, (m, name) => (names.has(name) ? `<span class="font-bold text-[oklch(78%_0.155_234)]">${m}</span>` : m));
}
