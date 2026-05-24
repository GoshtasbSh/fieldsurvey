"use client";

import { useState } from "react";
import { Upload, Loader2, CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";

type Step = "upload" | "configure" | "preview" | "running" | "done";
type Row = Record<string, string | number | boolean | null>;

/**
 * Two-step wizard:
 *   1. Upload CSV → parse client-side
 *   2. Pick the address column (REQUIRED — we never trust response lat/lon),
 *      optional external-id column for de-dup
 *   3. Confirm → POST /api/responses/import → server matches via Python
 */
export function ImportWizard({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("upload");
  const [filename, setFilename] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [addressColumn, setAddressColumn] = useState("");
  const [externalIdColumn, setExternalIdColumn] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ inserted: number } | null>(null);

  async function onFile(f: File) {
    setError(null);
    setFilename(f.name);
    const text = await f.text();
    const parsed = parseCsv(text);
    if (!parsed.rows.length) { setError("CSV has no rows"); return; }
    setHeaders(parsed.headers);
    setRows(parsed.rows);
    // Heuristic: pick the column with "address" in its name
    const guess = parsed.headers.find((h) => /address|street|location/i.test(h)) ?? "";
    setAddressColumn(guess);
    const idGuess = parsed.headers.find((h) => /response.*id|external.*id|^id$/i.test(h)) ?? "";
    setExternalIdColumn(idGuess);
    setStep("configure");
  }

  async function onCommit() {
    if (!addressColumn) { setError("Pick the address column."); return; }
    setBusy(true);
    setStep("running");
    try {
      const r = await fetch("/api/responses/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          filename,
          address_column: addressColumn,
          external_id_column: externalIdColumn || null,
          rows,
        }),
      });
      const j = (await r.json()) as { inserted?: number; error?: string };
      if (!r.ok) throw new Error(j.error ?? `import failed (${r.status})`);
      setResult({ inserted: j.inserted ?? rows.length });
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("configure");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 rounded-2xl border border-[var(--shell-border)] bg-[var(--shell-1)] p-6">
      {step === "upload" && (
        <DropZone
          onFile={onFile}
          accept=".csv,text/csv"
          label="Drop a Qualtrics or Google Forms CSV, or click to choose"
        />
      )}

      {(step === "configure" || step === "preview") && (
        <div className="space-y-5">
          <div className="rounded-lg border border-[var(--shell-border)] bg-[var(--shell-2)] p-4">
            <div className="font-mono text-[12px] text-[var(--shell-text-2)]">{filename}</div>
            <div className="font-mono text-[11px] text-[var(--shell-text-muted)]">{rows.length} rows · {headers.length} columns</div>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--shell-text-muted)]">
              Which column is the respondent&apos;s home address? <span className="text-[oklch(68%_0.21_25)]">required</span>
            </label>
            <select
              value={addressColumn}
              onChange={(e) => setAddressColumn(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--shell-border)] bg-[var(--shell-2)] px-3 py-2 text-[13px]"
            >
              <option value="">— choose —</option>
              {headers.map((h) => (<option key={h} value={h}>{h}</option>))}
            </select>
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--shell-text-muted)]">
              We re-geocode this column via the U.S. Census geocoder. The response&apos;s own latitude/longitude (e.g. <span className="font-mono">LocationLatitude</span>) is <b>discarded</b> — it&apos;s where the survey was filled, not where the house is.
            </p>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--shell-text-muted)]">External ID column (optional, for de-duplication)</label>
            <select
              value={externalIdColumn}
              onChange={(e) => setExternalIdColumn(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--shell-border)] bg-[var(--shell-2)] px-3 py-2 text-[13px]"
            >
              <option value="">— none —</option>
              {headers.map((h) => (<option key={h} value={h}>{h}</option>))}
            </select>
          </div>

          <PreviewTable rows={rows.slice(0, 5)} addressColumn={addressColumn} />

          {error && <p className="text-[12px] text-[oklch(68%_0.21_25)]">{error}</p>}

          <div className="flex gap-2">
            <button
              onClick={() => { setStep("upload"); setRows([]); setHeaders([]); }}
              className="rounded-lg border border-[var(--shell-border)] bg-[var(--shell-2)] px-4 py-2 font-display text-[12px] font-bold text-[var(--shell-text-2)] hover:bg-[var(--shell-3)] transition"
            >
              Re-upload
            </button>
            <button
              onClick={onCommit}
              disabled={busy || !addressColumn}
              className="ml-auto inline-flex items-center gap-2 rounded-lg bg-[oklch(78%_0.155_234)] px-4 py-2 font-display text-[12px] font-bold text-[var(--shell-base)] shadow-[0_4px_14px_oklch(78%_0.155_234/0.4)] disabled:opacity-50 transition"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Commit {rows.length} rows → run matching
            </button>
          </div>
        </div>
      )}

      {step === "running" && (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-[oklch(78%_0.155_234)]" />
          <div className="font-display text-[14px] font-bold">Importing and matching…</div>
          <div className="text-[11px] text-[var(--shell-text-muted)]">Geocoding each address via the U.S. Census, then snapping responses to field points within 30 meters.</div>
        </div>
      )}

      {step === "done" && result && (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <CheckCircle2 className="h-10 w-10 text-[oklch(76%_0.16_158)]" />
          <div className="font-display text-[16px] font-extrabold">Import complete</div>
          <div className="text-[12px] text-[var(--shell-text-2)]">{result.inserted} responses imported. Matching is running server-side; counts will update shortly.</div>
          <div className="mt-3 flex gap-2">
            <button onClick={() => router.push(`/p/${projectId}/map`)} className="rounded-lg bg-[oklch(78%_0.155_234)] px-4 py-2 font-display text-[12px] font-bold text-[var(--shell-base)]">View map</button>
            <button onClick={() => { setStep("upload"); setRows([]); setResult(null); }} className="rounded-lg border border-[var(--shell-border)] px-4 py-2 font-display text-[12px] font-bold text-[var(--shell-text-2)]">Import more</button>
          </div>
        </div>
      )}
    </div>
  );
}

function DropZone({ onFile, accept, label }: { onFile: (f: File) => void; accept: string; label: string }) {
  return (
    <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[var(--shell-border)] bg-[var(--shell-2)] py-16 text-center transition hover:border-[oklch(78%_0.155_234/0.5)]">
      <Upload className="h-8 w-8 text-[oklch(78%_0.155_234)]" strokeWidth={1.7} />
      <span className="text-[13px] text-[var(--shell-text-2)]">{label}</span>
      <input type="file" accept={accept} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
    </label>
  );
}

function PreviewTable({ rows, addressColumn }: { rows: Row[]; addressColumn: string }) {
  if (!rows.length) return null;
  const headers = Object.keys(rows[0]);
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--shell-border)]">
      <table className="w-full text-[11px]">
        <thead className="bg-[var(--shell-2)]">
          <tr>
            {headers.map((h) => (
              <th key={h} className={`whitespace-nowrap px-2 py-1.5 text-left font-bold ${h === addressColumn ? "text-[oklch(78%_0.155_234)]" : "text-[var(--shell-text-muted)]"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-[var(--shell-border)]">
              {headers.map((h) => (
                <td key={h} className={`whitespace-nowrap px-2 py-1.5 ${h === addressColumn ? "text-[var(--shell-text)]" : "text-[var(--shell-text-2)]"}`}>
                  {String(r[h] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Tiny CSV parser — handles quoted fields with embedded commas/newlines. */
function parseCsv(text: string): { headers: string[]; rows: Row[] } {
  const lines: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { cur.push(field); field = ""; }
      else if (c === "\n") { cur.push(field); lines.push(cur); cur = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field.length || cur.length) { cur.push(field); lines.push(cur); }
  if (!lines.length) return { headers: [], rows: [] };
  const headers = lines[0];
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 1 && line[0] === "") continue; // empty row
    const r: Row = {};
    for (let j = 0; j < headers.length; j++) r[headers[j]] = line[j] ?? "";
    rows.push(r);
  }
  return { headers, rows };
}
