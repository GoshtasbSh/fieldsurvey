"use client";

import { useEffect, useRef, useState } from "react";
import { Upload, MapPin, Trash2, Loader2 } from "lucide-react";

type UniverseSummary = {
  total: number;
  visited: number;
  skipped: number;
};

/**
 * Canvass-mode toggle + universe CSV uploader (M5).
 *
 * Owner/admin only. Two parts:
 *   1. Toggle that flips project_settings.canvass_mode. When off, the rest
 *      of the card is disabled — visible but inert — so the admin can see
 *      what's behind the feature without accidentally uploading.
 *   2. CSV drag-and-drop uploader. Required header column `address`.
 *      Posts multipart/form-data to /api/.../universe/upload.
 */
export function UniverseUploader({
  projectId,
  initialCanvassMode,
}: {
  projectId: string;
  initialCanvassMode: boolean;
}) {
  const [canvassMode, setCanvassMode] = useState(initialCanvassMode);
  const [savingToggle, setSavingToggle] = useState(false);
  const [summary, setSummary] = useState<UniverseSummary | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function loadSummary() {
    try {
      const [allRes, visRes, skipRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/universe?limit=1`),
        fetch(`/api/projects/${projectId}/universe?status=visited&limit=1`),
        fetch(`/api/projects/${projectId}/universe?status=skipped&limit=1`),
      ]);
      if (!allRes.ok) return;
      const all = await allRes.json();
      const visited = visRes.ok ? (await visRes.json()).total ?? 0 : 0;
      const skipped = skipRes.ok ? (await skipRes.json()).total ?? 0 : 0;
      setSummary({ total: all.total ?? 0, visited, skipped });
    } catch {
      /* leave null */
    }
  }

  useEffect(() => {
    loadSummary();
  }, [projectId]);

  async function toggle() {
    const next = !canvassMode;
    setSavingToggle(true);
    setCanvassMode(next);
    try {
      const res = await fetch(`/api/projects/${projectId}/universe`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canvass_mode: next }),
      });
      if (!res.ok) {
        setCanvassMode(!next); // revert
      }
    } catch {
      setCanvassMode(!next);
    } finally {
      setSavingToggle(false);
    }
  }

  async function uploadFile(file: File) {
    setUploading(true);
    setUploadMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/projects/${projectId}/universe/upload`, {
        method: "POST",
        body: fd,
      });
      const body = await res.json();
      if (!res.ok) {
        setUploadMsg(body?.error ?? `HTTP ${res.status}`);
      } else {
        const parts: string[] = [];
        if (body.inserted) parts.push(`${body.inserted} addresses imported`);
        if (body.skipped) parts.push(`${body.skipped} skipped (blank address)`);
        if (Array.isArray(body.errors) && body.errors.length) {
          parts.push(`${body.errors.length} batches errored`);
        }
        setUploadMsg(parts.join(" · ") || "Nothing imported.");
        loadSummary();
      }
    } catch (err) {
      setUploadMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  function onDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) uploadFile(f);
  }

  async function clearAll() {
    if (
      !confirm(
        `Clear ALL ${summary?.total ?? "universe"} addresses? Visited markers will be lost. This cannot be undone.`,
      )
    )
      return;
    try {
      const res = await fetch(`/api/projects/${projectId}/universe`, {
        method: "DELETE",
        headers: { "x-confirm": "yes" },
      });
      if (res.ok) {
        setUploadMsg("Universe cleared.");
        loadSummary();
      } else {
        const body = await res.json().catch(() => ({}));
        setUploadMsg(body?.error ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setUploadMsg(err instanceof Error ? err.message : String(err));
    }
  }

  const disabled = !canvassMode;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-[14px] font-bold text-[var(--bento-ink-1)]">
            Canvass universe
          </h3>
          <p className="mt-0.5 text-[12px] text-[var(--bento-ink-3)]">
            Upload a list of addresses to canvass. The mobile shell shows a to-visit list; analytics
            switch to canvass-completion %. Turn off to revert to free-form collection.
          </p>
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={savingToggle}
          aria-pressed={canvassMode}
          className="bento-focus relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition"
          style={{
            background: canvassMode ? "var(--bento-accent)" : "var(--bento-surface-3)",
          }}
        >
          <span
            className="inline-block h-5 w-5 transform rounded-full bg-white transition"
            style={{ transform: canvassMode ? "translateX(22px)" : "translateX(2px)" }}
          />
        </button>
      </div>

      {summary && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Total", value: summary.total },
            { label: "Visited", value: summary.visited },
            { label: "Remaining", value: Math.max(0, summary.total - summary.visited - summary.skipped) },
          ].map((m) => (
            <div key={m.label} className="bento-panel-inset px-3 py-2">
              <div className="text-[10.5px] uppercase tracking-wider text-[var(--bento-ink-3)]">
                {m.label}
              </div>
              <div className="font-display text-[18px] font-bold text-[var(--bento-ink-1)]">
                {m.value.toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}

      <label
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={disabled ? undefined : onDrop}
        className={[
          "bento-focus flex cursor-pointer flex-col items-center gap-2 rounded-[14px] border border-dashed px-4 py-6 text-center transition",
          disabled
            ? "cursor-not-allowed border-[var(--bento-rule)] text-[var(--bento-ink-4)] opacity-60"
            : dragOver
              ? "border-[var(--bento-accent)] bg-[var(--bento-accent-soft)] text-[var(--bento-accent)]"
              : "border-[var(--bento-rule)] text-[var(--bento-ink-3)] hover:border-[var(--bento-accent)] hover:text-[var(--bento-accent)]",
        ].join(" ")}
      >
        {uploading ? (
          <Loader2 className="h-5 w-5 animate-spin" strokeWidth={2} />
        ) : (
          <MapPin className="h-5 w-5" strokeWidth={1.8} />
        )}
        <div className="text-[12.5px] font-medium">
          {uploading ? "Uploading…" : disabled ? "Enable canvass mode to upload" : "Drop CSV here or click to choose"}
        </div>
        <div className="text-[10.5px] text-[var(--bento-ink-3)]">
          Required column: <code className="font-mono">address</code>. Optional:{" "}
          <code className="font-mono">lat</code>, <code className="font-mono">lon</code>,{" "}
          <code className="font-mono">external_id</code>.
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          disabled={disabled || uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadFile(f);
            if (fileRef.current) fileRef.current.value = "";
          }}
        />
        {!disabled && !uploading && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              fileRef.current?.click();
            }}
            className="mt-1 inline-flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[12px] font-semibold transition"
            style={{ background: "var(--bento-ink-1)", color: "var(--bento-bg)" }}
          >
            <Upload className="h-3.5 w-3.5" strokeWidth={2} />
            Choose CSV
          </button>
        )}
      </label>

      {uploadMsg && (
        <div
          className="rounded-[10px] px-3 py-2 text-[11.5px]"
          style={{
            background: "var(--bento-accent-soft)",
            color: "var(--bento-accent)",
          }}
        >
          {uploadMsg}
        </div>
      )}

      {summary && summary.total > 0 && !disabled && (
        <button
          onClick={clearAll}
          className="bento-focus inline-flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[11.5px] font-medium text-[var(--bento-ink-3)] transition hover:bg-[var(--bento-danger-soft)] hover:text-[var(--bento-danger)]"
        >
          <Trash2 className="h-3 w-3" strokeWidth={2} />
          Clear universe
        </button>
      )}
    </div>
  );
}
