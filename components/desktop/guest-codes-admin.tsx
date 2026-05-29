"use client";

import { useEffect, useState } from "react";
import { Loader2, KeyRound, Trash2, Plus, Copy, Check } from "lucide-react";

type GuestCode = {
  id: string;
  code: string;
  label: string | null;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
};

/**
 * Admin generator + revoke list for guest day-codes (M5).
 * Owner/admin only. Same Bento panel grammar as recipients-admin.
 */
export function GuestCodesAdmin({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<GuestCode[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [addLabel, setAddLabel] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch(`/api/projects/${projectId}/guest-codes`);
      if (!res.ok) return;
      const body = await res.json();
      setRows(body.codes ?? []);
    } catch {
      /* leave empty */
    }
  }

  useEffect(() => {
    load();
  }, [projectId]);

  async function issue(e: React.FormEvent) {
    e.preventDefault();
    setAddBusy(true);
    setAddError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/guest-codes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: addLabel.trim() || null }),
      });
      const body = await res.json();
      if (!res.ok) {
        setAddError(body?.error ?? `HTTP ${res.status}`);
      } else {
        setAddLabel("");
        setAdding(false);
        setRows((prev) => [body.code, ...(prev ?? [])]);
      }
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err));
    } finally {
      setAddBusy(false);
    }
  }

  async function revoke(r: GuestCode) {
    if (!confirm(`Revoke code ${r.code}? Active guest sessions will be blocked.`)) return;
    setRows((prev) => (prev ?? []).filter((x) => x.id !== r.id));
    try {
      await fetch(`/api/projects/${projectId}/guest-codes/${r.id}`, { method: "DELETE" });
    } catch {
      load();
    }
  }

  async function copyCode(r: GuestCode) {
    try {
      await navigator.clipboard.writeText(r.code);
      setCopiedId(r.id);
      setTimeout(() => setCopiedId((id) => (id === r.id ? null : id)), 1500);
    } catch {
      /* clipboard blocked; no-op */
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-[14px] font-bold text-[var(--bento-ink-1)]">
            Guest day-codes
          </h3>
          <p className="mt-0.5 text-[12px] text-[var(--bento-ink-3)]">
            Codes are valid for 24 hours and let surveyors collect points without a personal account.
            Share them in person or over a secure channel; revoking immediately blocks the cookie.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {rows === null && (
          <div className="bento-panel-inset flex items-center gap-2 px-3 py-2 text-[11.5px] text-[var(--bento-ink-3)]">
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
            Loading…
          </div>
        )}
        {rows !== null && rows.length === 0 && (
          <div className="bento-panel-inset px-3 py-3 text-[12px] text-[var(--bento-ink-3)]">
            No active codes. Issue the first one below.
          </div>
        )}
        {(rows ?? []).map((r) => {
          const expiresIn = Math.max(0, Math.floor((Date.parse(r.expires_at) - Date.now()) / 3_600_000));
          return (
            <div key={r.id} className="bento-panel flex items-center gap-3 p-3">
              <span
                className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px]"
                style={{
                  background: "var(--bento-accent-soft)",
                  color: "var(--bento-accent)",
                }}
              >
                <KeyRound className="h-3.5 w-3.5" strokeWidth={2} />
              </span>
              <div className="flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[15px] font-bold tracking-[0.25em] text-[var(--bento-ink-1)]">
                    {r.code}
                  </span>
                  {r.label && (
                    <span className="text-[11.5px] text-[var(--bento-ink-2)]">
                      {r.label}
                    </span>
                  )}
                </div>
                <div className="text-[10.5px] text-[var(--bento-ink-3)]">
                  Issued {new Date(r.issued_at).toLocaleString()} · expires in {expiresIn}h
                </div>
              </div>
              <button
                onClick={() => copyCode(r)}
                className="bento-focus inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--bento-ink-3)] hover:bg-[var(--bento-surface-3)] hover:text-[var(--bento-ink-1)]"
                title="Copy code"
              >
                {copiedId === r.id ? (
                  <Check className="h-3.5 w-3.5" strokeWidth={2} />
                ) : (
                  <Copy className="h-3.5 w-3.5" strokeWidth={2} />
                )}
              </button>
              <button
                onClick={() => revoke(r)}
                className="bento-focus inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--bento-ink-3)] hover:bg-[var(--bento-danger-soft)] hover:text-[var(--bento-danger)]"
                title="Revoke"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </div>
          );
        })}
      </div>

      {adding ? (
        <form onSubmit={issue} className="bento-panel space-y-2 p-3">
          <input
            type="text"
            placeholder="Label (e.g. Tuesday team)"
            value={addLabel}
            onChange={(e) => setAddLabel(e.target.value)}
            autoFocus
            maxLength={120}
            className="w-full rounded-[10px] border border-[var(--bento-rule)] bg-[var(--bento-surface)] px-3 py-2 text-[12px] text-[var(--bento-ink-1)] outline-none focus:border-[var(--bento-accent)]"
          />
          {addError && (
            <div className="text-[11px]" style={{ color: "var(--bento-danger)" }}>
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
              style={{ background: "var(--bento-ink-1)", color: "var(--bento-bg)" }}
            >
              {addBusy ? "Issuing…" : "Issue code"}
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="bento-focus inline-flex items-center gap-1.5 rounded-[10px] border border-dashed border-[var(--bento-rule)] px-3 py-2 text-[12px] font-medium text-[var(--bento-ink-3)] transition hover:border-[var(--bento-accent)] hover:text-[var(--bento-accent)]"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          Issue new code
        </button>
      )}
    </div>
  );
}
