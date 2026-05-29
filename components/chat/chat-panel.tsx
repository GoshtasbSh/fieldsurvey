"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Send, Paperclip, X, Loader2 } from "lucide-react";
import { createBrowserSupabase } from "@/lib/supabase/client";
import type { ChatMessage, ChatAttachment } from "@/lib/queries/chat";

type Member = { user_id: string; display_name: string; email: string; avatar_url: string | null };
type Presence = { user_id: string; online_at: string };

type Props = {
  projectId: string;
  currentUserId: string;
  members: Member[];
  initial: ChatMessage[];
  /** When false, the composer is replaced with a read-only notice (viewer role). */
  canWrite?: boolean;
};

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/gif",
]);
const MAX_ATTACH_SIZE = 10 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_MESSAGE = 6;

type PendingAttachment = {
  id: string; // client-side temp id
  file: File;
  previewUrl: string;
};

/**
 * Chat panel — used inside the Team tab on both desktop and mobile.
 *
 * Locked Q6: images-only attachments, 10 MB per file, multi-attachment per
 * message via the chat_message_attachments join table. Upload goes
 * client-side to the `chat-attachments` Storage bucket (RLS scoped by path
 * prefix); metadata insert via /api/chat/:messageId/attachments.
 */
export function ChatPanel({ projectId, currentUserId, members, initial, canWrite = true }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>(initial);
  const [body, setBody] = useState("");
  const [presence, setPresence] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [mentionAnchor, setMentionAnchor] = useState<{ start: number; query: string } | null>(null);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sb = useMemo(() => createBrowserSupabase(), []);

  const memberByName = useMemo(() => {
    const m = new Map<string, Member>();
    for (const x of members) m.set(x.display_name.toLowerCase(), x);
    return m;
  }, [members]);

  // Realtime: chat + presence
  useEffect(() => {
    const channel = sb.channel(`chat:${projectId}`, { config: { presence: { key: currentUserId } } });

    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "chat_messages", filter: `project_id=eq.${projectId}` },
      async (payload) => {
        const row = payload.new as ChatMessage;
        const author = members.find((m) => m.user_id === row.author_id);
        // Pull attachments for the new row if any exist by the time realtime fires.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: atts } = await (sb.from("chat_message_attachments") as any)
          .select("id, path, mime, size, name, width_px, height_px")
          .eq("message_id", row.id);
        setMessages((prev) => {
          if (prev.some((m) => m.id === row.id)) return prev;
          return [
            ...prev,
            {
              ...row,
              author: author
                ? { display_name: author.display_name, email: author.email, avatar_url: author.avatar_url }
                : undefined,
              attachments: (atts as ChatAttachment[]) ?? [],
            },
          ];
        });
      },
    );
    channel.on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "chat_messages", filter: `project_id=eq.${projectId}` },
      (payload) => {
        const old = payload.old as { id: string };
        setMessages((prev) => prev.filter((m) => m.id !== old.id));
      },
    );

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

  // Revoke preview object URLs on unmount / removal
  useEffect(() => {
    return () => {
      pending.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-picking the same file later
    if (files.length === 0) return;
    setAttachError(null);

    const next: PendingAttachment[] = [];
    for (const f of files) {
      if (!ALLOWED_MIME.has(f.type)) {
        setAttachError(`Unsupported: ${f.name}. Images only (JPEG/PNG/WebP/HEIC/GIF).`);
        continue;
      }
      if (f.size > MAX_ATTACH_SIZE) {
        setAttachError(`Too large: ${f.name}. 10 MB max.`);
        continue;
      }
      next.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        file: f,
        previewUrl: URL.createObjectURL(f),
      });
    }
    setPending((cur) => {
      const merged = [...cur, ...next].slice(0, MAX_ATTACHMENTS_PER_MESSAGE);
      if ([...cur, ...next].length > MAX_ATTACHMENTS_PER_MESSAGE) {
        setAttachError(`Max ${MAX_ATTACHMENTS_PER_MESSAGE} images per message.`);
      }
      return merged;
    });
  }

  function removePending(id: string) {
    setPending((cur) => {
      const found = cur.find((p) => p.id === id);
      if (found) URL.revokeObjectURL(found.previewUrl);
      return cur.filter((p) => p.id !== id);
    });
  }

  async function send() {
    const trimmed = body.trim();
    // Allow attachment-only sends by using a placeholder body; the DB
    // requires body length ≥1.
    const effectiveBody = trimmed || (pending.length > 0 ? "📎" : "");
    if (!effectiveBody) return;
    setSending(true);
    const mentions: string[] = [];
    for (const match of trimmed.matchAll(/@([\w]+)/g)) {
      const m = memberByName.get(match[1].toLowerCase());
      if (m) mentions.push(m.user_id);
    }
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          body: effectiveBody,
          mentions: [...new Set(mentions)],
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const { id: messageId } = (await r.json()) as { id: string };

      // Upload each pending attachment to chat-attachments bucket.
      if (pending.length > 0) {
        const uploaded: Array<{
          path: string;
          mime: string;
          size: number;
          name: string;
        }> = [];
        for (const p of pending) {
          const safeName = sanitizeFilename(p.file.name);
          const path = `${projectId}/${messageId}/${Date.now()}-${safeName}`;
          const { error } = await sb.storage
            .from("chat-attachments")
            .upload(path, p.file, {
              cacheControl: "3600",
              contentType: p.file.type,
              upsert: false,
            });
          if (error) {
            console.warn("attachment upload failed", error);
            continue;
          }
          uploaded.push({ path, mime: p.file.type, size: p.file.size, name: safeName });
        }
        if (uploaded.length > 0) {
          await fetch(`/api/chat/${messageId}/attachments`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ attachments: uploaded }),
          });
        }
      }

      setBody("");
      pending.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      setPending([]);
    } finally {
      setSending(false);
    }
  }

  const mentionSuggestions = mentionAnchor
    ? members.filter((m) => m.display_name.toLowerCase().includes(mentionAnchor.query)).slice(0, 5)
    : [];

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bento-bg)]">
      {/* presence strip */}
      <div className="flex items-center gap-2 border-b border-[var(--bento-rule)] bg-[var(--bento-surface)] px-3 py-2 text-[11px] text-[var(--bento-ink-3)]">
        <span
          className="relative h-2 w-2 rounded-full"
          style={{ background: "var(--bento-success)" }}
        />
        {presence.size} online ·
        <div className="flex -space-x-1.5">
          {members
            .filter((m) => presence.has(m.user_id))
            .slice(0, 5)
            .map((m) => (
              <div
                key={m.user_id}
                title={m.display_name}
                className="inline-flex h-5 w-5 items-center justify-center rounded-full border-2 text-[8px] font-bold text-white"
                style={{
                  background: gradFromId(m.user_id),
                  borderColor: "var(--bento-surface)",
                }}
              >
                {initials(m.display_name)}
              </div>
            ))}
        </div>
      </div>

      {/* messages */}
      <div
        ref={scrollerRef}
        className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3"
      >
        {messages.length === 0 && (
          <p className="text-center text-[11.5px] text-[var(--bento-ink-3)]">
            No messages yet. Say hi.
          </p>
        )}
        {messages.map((m) => {
          const mine = m.author_id === currentUserId;
          const name = m.author?.display_name || m.author?.email?.split("@")[0] || "Member";
          const showBody = m.body && m.body !== "📎";
          return (
            <div key={m.id} className={`flex gap-2 ${mine ? "flex-row-reverse" : "flex-row"}`}>
              <div
                className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                style={{
                  background: gradFromId(m.author_id),
                  boxShadow: presence.has(m.author_id)
                    ? `0 0 0 2px var(--bento-surface), 0 0 0 4px var(--bento-success)`
                    : undefined,
                }}
              >
                {initials(name)}
              </div>
              <div
                className="max-w-[78%] rounded-[16px] px-3 py-2 text-[12.5px] leading-relaxed"
                style={{
                  background: mine ? "var(--bento-accent-soft)" : "var(--bento-surface)",
                  color: "var(--bento-ink-1)",
                  boxShadow: "var(--bento-shadow-xs)",
                  border: "1px solid var(--bento-rule)",
                }}
              >
                <div className={`mb-0.5 flex items-baseline gap-2 ${mine ? "justify-end" : ""}`}>
                  <span className="font-display text-[11px] font-bold text-[var(--bento-ink-1)]">
                    {name}
                  </span>
                  <span className="font-mono text-[9.5px] text-[var(--bento-ink-3)]">
                    {relTime(m.created_at)}
                  </span>
                </div>
                {showBody && (
                  <div
                    dangerouslySetInnerHTML={{
                      __html: highlightMentions(escapeHtml(m.body), members),
                    }}
                  />
                )}
                {m.attachments && m.attachments.length > 0 && (
                  <AttachmentStrip
                    attachments={m.attachments}
                    onOpen={(url, name) => setLightbox({ url, name })}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* composer */}
      {!canWrite ? (
        <div
          className="border-t border-[var(--bento-rule)] bg-[var(--bento-surface)] px-4 py-3 text-center text-[12px]"
          style={{ color: "var(--bento-ink-3)" }}
        >
          You have read-only access to chat for this project.
        </div>
      ) : (
      <div className="relative border-t border-[var(--bento-rule)] bg-[var(--bento-surface)] p-2">
        {mentionSuggestions.length > 0 && (
          <div
            className="absolute bottom-full left-2 right-2 mb-1 overflow-hidden rounded-[12px] border border-[var(--bento-rule)] bg-[var(--bento-surface)]"
            style={{ boxShadow: "var(--bento-shadow-md)" }}
          >
            {mentionSuggestions.map((m) => (
              <button
                key={m.user_id}
                onClick={() => applyMention(m)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-[var(--bento-ink-1)] hover:bg-[var(--bento-surface-2)]"
              >
                <span
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-white"
                  style={{ background: gradFromId(m.user_id) }}
                >
                  {initials(m.display_name)}
                </span>
                <span>{m.display_name}</span>
              </button>
            ))}
          </div>
        )}

        {pending.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5 px-1">
            {pending.map((p) => (
              <div
                key={p.id}
                className="relative h-14 w-14 overflow-hidden rounded-[10px] border border-[var(--bento-rule)] bg-[var(--bento-surface-2)]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.previewUrl}
                  alt={p.file.name}
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => removePending(p.id)}
                  className="absolute right-0.5 top-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-white"
                  style={{ background: "var(--bento-danger)" }}
                  aria-label={`Remove ${p.file.name}`}
                >
                  <X className="h-2.5 w-2.5" strokeWidth={2.5} />
                </button>
              </div>
            ))}
          </div>
        )}
        {attachError && (
          <div
            className="mb-1.5 rounded-[8px] px-2 py-1 text-[11px]"
            style={{
              background: "var(--bento-danger-soft)",
              color: "var(--bento-danger)",
            }}
          >
            {attachError}
          </div>
        )}

        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending || pending.length >= MAX_ATTACHMENTS_PER_MESSAGE}
            className="bento-focus inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-[var(--bento-rule)] text-[var(--bento-ink-2)] transition hover:bg-[var(--bento-surface-2)] hover:text-[var(--bento-ink-1)] disabled:opacity-50"
            aria-label="Attach image"
            title="Attach image (max 10 MB)"
          >
            <Paperclip className="h-4 w-4" strokeWidth={2} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif"
            onChange={onPickFiles}
            className="hidden"
          />
          <textarea
            value={body}
            onChange={(e) => onBodyChange(e.target.value, e.target.selectionStart)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Message your team…  use @ to mention"
            rows={1}
            className="max-h-32 flex-1 resize-none rounded-[10px] border border-[var(--bento-rule)] bg-[var(--bento-surface-2)] px-3 py-2 text-[13px] text-[var(--bento-ink-1)] outline-none focus:border-[var(--bento-accent)]"
          />
          <button
            onClick={send}
            disabled={sending || (!body.trim() && pending.length === 0)}
            className="bento-focus inline-flex h-9 w-9 items-center justify-center rounded-[10px] transition disabled:opacity-50"
            style={{
              background: "var(--bento-accent)",
              color: "var(--bento-on-accent)",
              boxShadow: "var(--bento-shadow-sm)",
            }}
            aria-label="Send"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
            ) : (
              <Send className="h-4 w-4" strokeWidth={2} />
            )}
          </button>
        </div>
      </div>
      )}

      {lightbox && (
        <Lightbox
          url={lightbox.url}
          name={lightbox.name}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

// ── Attachment strip — lazy-signs URLs for thumbnails ─────────────────────
function AttachmentStrip({
  attachments,
  onOpen,
}: {
  attachments: ChatAttachment[];
  onOpen: (url: string, name: string) => void;
}) {
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  const sb = useMemo(() => createBrowserSupabase(), []);

  const ids = useMemo(() => attachments.map((a) => a.id).join(","), [attachments]);

  const signAll = useCallback(async () => {
    const paths = attachments.map((a) => a.path);
    if (paths.length === 0) return;
    const { data } = await sb.storage
      .from("chat-attachments")
      .createSignedUrls(paths, 60 * 60);
    const map: Record<string, string | null> = {};
    attachments.forEach((a, i) => {
      map[a.id] = data?.[i]?.signedUrl ?? null;
    });
    setUrls(map);
  }, [attachments, sb]);

  useEffect(() => {
    void signAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  return (
    <div className="mt-2 grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))" }}>
      {attachments.map((a) => {
        const url = urls[a.id];
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => url && onOpen(url, a.name)}
            disabled={!url}
            className="bento-focus overflow-hidden rounded-[10px] border border-[var(--bento-rule)] bg-[var(--bento-surface-2)] transition hover:scale-[1.02] disabled:opacity-60"
            style={{ aspectRatio: "1 / 1" }}
            title={a.name}
          >
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt={a.name}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-[10px] text-[var(--bento-ink-3)]">
                loading…
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Lightbox — modal viewer ───────────────────────────────────────────────
function Lightbox({
  url,
  name,
  onClose,
}: {
  url: string;
  name: string;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/80 p-6"
      onClick={onClose}
      role="dialog"
      aria-modal
      aria-label={`Image preview: ${name}`}
    >
      <div
        className="relative max-h-full max-w-full"
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={name}
          className="max-h-[90vh] max-w-[90vw] rounded-[12px]"
          style={{ boxShadow: "var(--bento-shadow-lg)" }}
        />
        <button
          onClick={onClose}
          className="absolute -right-3 -top-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-black shadow-lg"
          aria-label="Close"
        >
          <X className="h-4 w-4" strokeWidth={2.5} />
        </button>
        <div className="mt-2 text-center text-[11px] text-white/80">{name}</div>
      </div>
    </div>
  );
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 120);
}
function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();
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
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c),
  );
}
function highlightMentions(text: string, members: Member[]): string {
  const names = new Set(members.map((m) => m.display_name.replace(/\s+/g, "")));
  return text.replace(/@(\w+)/g, (m, name) =>
    names.has(name)
      ? `<span class="font-bold" style="color:var(--bento-accent)">${m}</span>`
      : m,
  );
}
