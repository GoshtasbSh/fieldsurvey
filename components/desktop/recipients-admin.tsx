"use client";

import { useEffect, useState } from "react";
import { Loader2, Mail, Pause, Play, Trash2, Send, Plus } from "lucide-react";

type Recipient = {
  id: string;
  name: string | null;
  email: string;
  paused: boolean;
  last_sent_at: string | null;
  created_at: string;
};

/**
 * Change-report recipients admin (locked Q2).
 *
 * Owner/admin only. Manages the per-project list of external email
 * addresses that get the daily digest, plus an immediate "Send now"
 * button. Recipients with zero new points/responses since `last_sent_at`
 * are silently skipped.
 */
export function RecipientsAdmin({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<Recipient[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [addName, setAddName] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [sendingNow, setSendingNow] = useState(false);
  const [sendMsg, setSendMsg] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch(`/api/projects/${projectId}/recipients`);
      if (!res.ok) return;
      const body = await res.json();
      setRows(body.recipients ?? []);
    } catch {
      /* leave empty */
    }
  }

  useEffect(() => {
    load();
  }, [projectId]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setAddBusy(true);
    setAddError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/recipients`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: addEmail.trim(), name: addName.trim() || null }),
      });
      const body = await res.json();
      if (!res.ok) {
        setAddError(body?.error ?? `HTTP ${res.status}`);
      } else {
        setAddEmail("");
        setAddName("");
        setAdding(false);
        setRows((prev) => [body.recipient, ...(prev ?? [])]);
      }
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err));
    } finally {
      setAddBusy(false);
    }
  }

  async function togglePaused(r: Recipient) {
    const next = !r.paused;
    setRows((prev) =>
      (prev ?? []).map((x) => (x.id === r.id ? { ...x, paused: next } : x)),
    );
    try {
      await fetch(`/api/projects/${projectId}/recipients/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: next }),
      });
    } catch {
      // revert on failure
      setRows((prev) =>
        (prev ?? []).map((x) => (x.id === r.id ? { ...x, paused: r.paused } : x)),
      );
    }
  }

  async function remove(r: Recipient) {
    if (!confirm(`Remove ${r.email} from the change-report list?`)) return;
    setRows((prev) => (prev ?? []).filter((x) => x.id !== r.id));
    try {
      await fetch(`/api/projects/${projectId}/recipients/${r.id}`, { method: "DELETE" });
    } catch {
      // best-effort; reload to be safe
      load();
    }
  }

  async function sendNow() {
    setSendingNow(true);
    setSendMsg(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/recipients/send-now`, {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok) {
        setSendMsg(body?.error ?? `HTTP ${res.status}`);
      } else {
        const parts: string[] = [];
        if (body.sent) parts.push(`${body.sent} sent`);
        if (body.skipped_empty)
          parts.push(`${body.skipped_empty} skipped (no changes)`);
        if (body.paused) parts.push(`${body.paused} paused`);
        if (body.failed) parts.push(`${body.failed} failed`);
        setSendMsg(parts.join(" · ") || "Nothing to send.");
        load();
      }
    } catch (err) {
      setSendMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSendingNow(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-[14px] font-bold text-[var(--bento-ink-1)]">
            Daily change-report recipients
          </h3>
          <p className="mt-0.5 text-[12px] text-[var(--bento-ink-3)]">
            External email addresses that receive the daily digest. Skipped silently when nothing has changed since the last send.
          </p>
        </div>
        <button
          onClick={sendNow}
          disabled={sendingNow || (rows?.length ?? 0) === 0}
          className="bento-focus inline-flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-[11.5px] font-semibold transition disabled:opacity-50"
          style={{
            background: "var(--bento-accent)",
            color: "var(--bento-on-accent)",
            boxShadow: "var(--bento-shadow-sm)",
          }}
        >
          {sendingNow ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
          ) : (
            <Send className="h-3.5 w-3.5" strokeWidth={2} />
          )}
          Send now
        </button>
      </div>

      {sendMsg && (
        <div
          className="rounded-[10px] px-3 py-2 text-[11.5px]"
          style={{
            background: "var(--bento-accent-soft)",
            color: "var(--bento-accent)",
          }}
        >
          {sendMsg}
        </div>
      )}

      <div className="space-y-2">
        {rows === null && (
          <div className="bento-panel-inset flex items-center gap-2 px-3 py-2 text-[11.5px] text-[var(--bento-ink-3)]">
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
            Loading…
          </div>
        )}
        {rows !== null && rows.length === 0 && (
          <div className="bento-panel-inset px-3 py-3 text-[12px] text-[var(--bento-ink-3)]">
            No recipients yet. Add the first one below.
          </div>
        )}
        {(rows ?? []).map((r) => (
          <div
            key={r.id}
            className="bento-panel flex items-center gap-3 p-3"
            style={r.paused ? { opacity: 0.6 } : undefined}
          >
            <span
              className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px]"
              style={{
                background: r.paused ? "var(--bento-surface-2)" : "var(--bento-accent-soft)",
                color: r.paused ? "var(--bento-ink-3)" : "var(--bento-accent)",
              }}
            >
              <Mail className="h-3.5 w-3.5" strokeWidth={2} />
            </span>
            <div className="flex-1">
              <div className="text-[12.5px] font-semibold text-[var(--bento-ink-1)]">
                {r.name || r.email.split("@")[0]}
              </div>
              <div className="text-[10.5px] text-[var(--bento-ink-3)]">
                {r.email} ·{" "}
                {r.last_sent_at
                  ? `last sent ${new Date(r.last_sent_at).toLocaleDateString()}`
                  : "never sent"}
                {r.paused && (
                  <span className="ml-1" style={{ color: "var(--bento-warning)" }}>
                    · paused
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={() => togglePaused(r)}
              className="bento-focus inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--bento-ink-3)] hover:bg-[var(--bento-surface-3)] hover:text-[var(--bento-ink-1)]"
              title={r.paused ? "Resume" : "Pause"}
            >
              {r.paused ? (
                <Play className="h-3.5 w-3.5" strokeWidth={2} />
              ) : (
                <Pause className="h-3.5 w-3.5" strokeWidth={2} />
              )}
            </button>
            <button
              onClick={() => remove(r)}
              className="bento-focus inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--bento-ink-3)] hover:bg-[var(--bento-danger-soft)] hover:text-[var(--bento-danger)]"
              title="Remove"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        ))}
      </div>

      {adding ? (
        <form onSubmit={add} className="bento-panel space-y-2 p-3">
          <input
            type="text"
            placeholder="Name (optional)"
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            className="w-full rounded-[10px] border border-[var(--bento-rule)] bg-[var(--bento-surface)] px-3 py-2 text-[12px] text-[var(--bento-ink-1)] outline-none focus:border-[var(--bento-accent)]"
          />
          <input
            type="email"
            required
            autoFocus
            placeholder="email@example.com"
            value={addEmail}
            onChange={(e) => setAddEmail(e.target.value)}
            className="w-full rounded-[10px] border border-[var(--bento-rule)] bg-[var(--bento-surface)] px-3 py-2 text-[12px] text-[var(--bento-ink-1)] outline-none focus:border-[var(--bento-accent)]"
          />
          {addError && (
            <div
              className="text-[11px]"
              style={{ color: "var(--bento-danger)" }}
            >
              {addError}
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setAddError(null);
              }}
              className="rounded-[10px] px-3 py-1.5 text-[12px] font-medium text-[var(--bento-ink-2)] hover:bg-[var(--bento-surface-3)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={addBusy}
              className="rounded-[10px] px-3 py-1.5 text-[12px] font-semibold transition disabled:opacity-50"
              style={{
                background: "var(--bento-ink-1)",
                color: "var(--bento-bg)",
              }}
            >
              {addBusy ? "Saving…" : "Add recipient"}
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="bento-focus inline-flex items-center gap-1.5 rounded-[10px] border border-dashed border-[var(--bento-rule)] px-3 py-2 text-[12px] font-medium text-[var(--bento-ink-3)] transition hover:border-[var(--bento-accent)] hover:text-[var(--bento-accent)]"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          Add recipient
        </button>
      )}
    </div>
  );
}
