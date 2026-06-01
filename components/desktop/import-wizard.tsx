"use client";

import { useEffect, useRef, useState } from "react";
import { Upload, Loader2, CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";

type Step = "upload" | "configure" | "preview" | "running" | "done";
type Row = Record<string, string | number | boolean | null>;

type MatcherResult = {
  geocoded: number;
  snapped_to_parcel: number;
  matched_now: number;
  m1_count: number;
  f1_count: number;
  r1_count: number;
};

type Progress = {
  status: "processing" | "completed" | "failed";
  processing_step: string | null;
  processing_done: number;
  processing_total: number;
  matched_count: number;
  field_only_count: number;
  response_only_count: number;
  row_count: number;
};

export function ImportWizard({
  projectId,
  defaultAddressSuffix = "",
  defaultAddressColumn = "",
  defaultExternalIdColumn = "",
  defaultStatusColumn = "",
  existingBySource = {},
}: {
  projectId: string;
  defaultAddressSuffix?: string;
  defaultAddressColumn?: string;
  defaultExternalIdColumn?: string;
  defaultStatusColumn?: string;
  /** Existing row counts per source ("qualtrics_csv" → 317). Drives the
   * "Replace existing N rows" copy in the wizard. */
  existingBySource?: Record<string, number>;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("upload");
  const [filename, setFilename] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [addressColumn, setAddressColumn] = useState(defaultAddressColumn);
  const [externalIdColumn, setExternalIdColumn] = useState<string>(defaultExternalIdColumn);
  const [statusColumn, setStatusColumn] = useState<string>(defaultStatusColumn);
  // Project-level suffix. Pre-filled with the project's last-used value. The
  // user sees it and only edits if it's wrong — no rewriting required.
  const [addressSuffix, setAddressSuffix] = useState<string>(defaultAddressSuffix);
  // Replace mode: wipe existing rows of the same source before inserting.
  // Default true — re-importing an updated canvassing log should replace,
  // not coexist. Content-hash dedup alone can't notice deleted/edited rows.
  const [replaceExisting, setReplaceExisting] = useState(true);
  // Source kind for the import. Today only qualtrics_csv is wired; the
  // server defaults to this too. Reserved for the future dual-upload
  // ("field canvass" CSV vs "survey response" CSV) split.
  const source = "qualtrics_csv";
  const existingCount = existingBySource[source] ?? 0;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [activeImportId, setActiveImportId] = useState<string | null>(null);
  const [result, setResult] = useState<{
    attempted: number;
    deleted_before_import: number;
    present_after_import: number;
    matcher: MatcherResult | null;
    matcher_error: string | null;
  } | null>(null);

  // Live poll the survey_imports row while the matcher is running so the
  // progress bar can show real "Geocoding 142 / 317" counts instead of an
  // opaque spinner.
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!activeImportId || (step !== "running" && !rerunning)) {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/projects/${projectId}/import-progress?import_id=${activeImportId}`, { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as Progress;
        if (cancelled) return;
        setProgress(j);
        if (j.status !== "processing") {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
      } catch { /* transient errors ignored — next tick retries */ }
    };
    tick();
    pollTimerRef.current = setInterval(tick, 1000);
    return () => {
      cancelled = true;
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    };
  }, [activeImportId, step, rerunning, projectId]);

  async function onFile(f: File) {
    setError(null);
    setFilename(f.name);
    const text = await f.text();
    const parsed = parseCsv(text);
    if (!parsed.rows.length) { setError("CSV has no rows"); return; }
    setHeaders(parsed.headers);
    setRows(parsed.rows);
    if (!addressColumn) {
      const guess = parsed.headers.find((h) => /address|street|location/i.test(h)) ?? "";
      setAddressColumn(guess);
    }
    if (!externalIdColumn) {
      const idGuess = parsed.headers.find((h) => /response.*id|external.*id|^id$/i.test(h)) ?? "";
      setExternalIdColumn(idGuess);
    }
    if (!statusColumn) {
      const sGuess = parsed.headers.find((h) => /attempt|status|outcome|disposition|result/i.test(h)) ?? "";
      setStatusColumn(sGuess);
    }
    setStep("configure");
  }

  async function onCommit() {
    if (!addressColumn) { setError("Pick the address column."); return; }
    const suffix = addressSuffix.trim();
    if (!suffix) { setError("Confirm the city, state, ZIP to append (or edit if the suggestion is wrong)."); return; }
    // Confirm before destructive replace.
    if (replaceExisting && existingCount > 0) {
      const ok = window.confirm(
        `This will delete the ${existingCount} existing ${source.replace("_", " ")} row${existingCount === 1 ? "" : "s"} stored for this project, then import the ${rows.length} rows from this CSV.\n\nContinue?`,
      );
      if (!ok) return;
    }
    setBusy(true);
    setProgress(null);
    setActiveImportId(null);
    setStep("running");
    try {
      // Poll for the active import row even before the POST resolves: the
      // matcher inserts a survey_imports row immediately and starts writing
      // progress, so the bar can update during Census calls.
      pollLatestImportUntilStarted();

      const r = await fetch("/api/responses/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          filename,
          address_column: addressColumn,
          external_id_column: externalIdColumn || null,
          response_status_column: statusColumn || null,
          geocode_address_suffix: suffix,
          replace_existing: replaceExisting,
          rows,
        }),
      });
      const j = (await r.json()) as {
        import_id?: string;
        attempted?: number;
        present_after_import?: number;
        error?: string;
        matcher?: MatcherResult | null;
        matcher_error?: string | null;
      };
      if (!r.ok) throw new Error(j.error ?? `import failed (${r.status})`);
      if (j.import_id) setActiveImportId(j.import_id);
      setResult({
        attempted: j.attempted ?? rows.length,
        deleted_before_import: (j as { deleted_before_import?: number }).deleted_before_import ?? 0,
        present_after_import: j.present_after_import ?? rows.length,
        matcher: j.matcher ?? null,
        matcher_error: j.matcher_error ?? null,
      });
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("configure");
    } finally {
      setBusy(false);
    }
  }

  // Best-effort: between hitting Commit and the POST resolving, peek at the
  // latest survey_imports row for this project so we can show progress
  // immediately. This is a one-shot — the useEffect picks up steady polling
  // once we have a concrete activeImportId.
  async function pollLatestImportUntilStarted() {
    const start = Date.now();
    while (Date.now() - start < 5000) {
      try {
        const r = await fetch(`/api/projects/${projectId}/import-progress`, { cache: "no-store" });
        if (r.ok) {
          const j = (await r.json()) as Progress & { id?: string };
          if (j?.processing_step === "geocoding" || j?.processing_step === "matching" || j?.processing_step === "inserting") {
            if (j.id) setActiveImportId(j.id);
            setProgress(j);
            return;
          }
        }
      } catch { /* ignore */ }
      await new Promise((res) => setTimeout(res, 400));
    }
  }

  async function onRerunMatch() {
    const fresh = window.prompt(
      "Confirm the city, state, ZIP (or any locality) to append to every street address before geocoding.\n" +
      "Census needs more than the street to resolve the location.",
      addressSuffix || "",
    );
    if (fresh === null) return;
    const suffix = fresh.trim();
    if (!suffix) { setResult((p) => p ? { ...p, matcher_error: "Suffix is required for geocoding." } : p); return; }
    setAddressSuffix(suffix);
    setRerunning(true);
    setProgress(null);
    // The /api/match shim doesn't create a survey_imports row, so the
    // progress poll has to use the latest survey_imports row for this
    // project. The matcher writes processing_step="geocoding" on the
    // most recent one when given import_id.
    void pollLatestImportUntilStarted();
    try {
      const r = await fetch(
        `/api/match?project_id=${encodeURIComponent(projectId)}&address_suffix=${encodeURIComponent(suffix)}`,
        { method: "POST" },
      );
      const j = (await r.json()) as { error?: string } & Partial<MatcherResult>;
      if (!r.ok) throw new Error(j.error ?? `match failed (${r.status})`);
      setResult((prev) => prev ? {
        ...prev,
        matcher: {
          geocoded: j.geocoded ?? 0,
          snapped_to_parcel: j.snapped_to_parcel ?? 0,
          matched_now: j.matched_now ?? 0,
          m1_count: j.m1_count ?? 0,
          f1_count: j.f1_count ?? 0,
          r1_count: j.r1_count ?? 0,
        },
        matcher_error: null,
      } : prev);
    } catch (e) {
      setResult((prev) => prev ? { ...prev, matcher_error: e instanceof Error ? e.message : String(e) } : prev);
    } finally {
      setRerunning(false);
    }
  }

  return (
    <div className="mt-8 rounded-2xl border border-[var(--shell-border)] bg-[var(--shell-1)] p-6">
      {step === "upload" && (
        <DropZone
          onFile={onFile}
          accept=".csv,text/csv"
          label="Drop a Qualtrics, Google Forms, or canvassing-log CSV — or click to choose"
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
              We re-geocode this column via the U.S. Census geocoder. Any response-side latitude/longitude (e.g. <span className="font-mono">LocationLatitude</span>) is <b>discarded</b> — that&apos;s where the survey was filled, not where the house is.
            </p>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--shell-text-muted)]">
              City, state, ZIP to append to every address
            </label>
            <input
              type="text"
              value={addressSuffix}
              onChange={(e) => setAddressSuffix(e.target.value)}
              placeholder="e.g. Keystone Heights, FL 32656"
              className="mt-1 w-full rounded-lg border border-[var(--shell-border)] bg-[var(--shell-2)] px-3 py-2 font-mono text-[12px]"
            />
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--shell-text-muted)]">
              {defaultAddressSuffix ? (
                <>This is what we used last time on this project. <b>If it&apos;s still right, leave it alone.</b> Edit only if this CSV is from a different area.</>
              ) : (
                <>Census can&apos;t resolve street-only addresses like &ldquo;6116 Harvard Avenue&rdquo; — Harvard Avenue exists in every state. Type the city / state / ZIP once and we&apos;ll remember it on the project for next time.</>
              )}
            </p>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--shell-text-muted)]">
              Which column is the canvassing status / outcome? <span className="text-[var(--shell-text-muted)] normal-case font-normal tracking-normal">(optional, but recommended)</span>
            </label>
            <select
              value={statusColumn}
              onChange={(e) => setStatusColumn(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--shell-border)] bg-[var(--shell-2)] px-3 py-2 text-[13px]"
            >
              <option value="">— none —</option>
              {headers.map((h) => (<option key={h} value={h}>{h}</option>))}
            </select>
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--shell-text-muted)]">
              For canvassing logs, pick the column that records what happened at each door (e.g. <span className="font-mono">First attempt</span>). We color the R1 markers on the map by this value so &ldquo;completed survey&rdquo; doors look different from &ldquo;Gated, inaccessible&rdquo; doors. Leave as <i>none</i> if your CSV has no status field — all R1 markers will be uniform purple.
            </p>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--shell-text-muted)]">
              Unique-row ID column <span className="text-[var(--shell-text-muted)] normal-case font-normal tracking-normal">(optional)</span>
            </label>
            <select
              value={externalIdColumn}
              onChange={(e) => setExternalIdColumn(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--shell-border)] bg-[var(--shell-2)] px-3 py-2 text-[13px]"
            >
              <option value="">— none —</option>
              {headers.map((h) => (<option key={h} value={h}>{h}</option>))}
            </select>
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--shell-text-muted)]">
              If your CSV has a per-row unique ID (Qualtrics calls it <span className="font-mono">ResponseId</span>), pick it so re-uploading the same file won&apos;t create duplicates. <b>Most field-collected CSVs don&apos;t have one — that&apos;s fine.</b> If you leave this on <i>none</i>, we dedup by row content automatically (same address + same answers ⇒ same row).
            </p>
          </div>

          <div className="rounded-lg border border-[var(--shell-border)] bg-[var(--shell-2)] p-3">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={replaceExisting}
                onChange={(e) => setReplaceExisting(e.target.checked)}
                className="mt-0.5 h-4 w-4 cursor-pointer accent-[oklch(78%_0.155_234)]"
              />
              <div>
                <div className="text-[12px] font-semibold text-[var(--shell-text)]">
                  Replace existing rows from previous imports
                </div>
                <div className="mt-0.5 text-[11px] leading-relaxed text-[var(--shell-text-muted)]">
                  {existingCount > 0 ? (
                    <>This project already has <b className="text-[var(--shell-text-2)]">{existingCount}</b> {source.replace("_", " ")} row{existingCount === 1 ? "" : "s"}. With this on, we delete them before importing the {rows.length} from this CSV — so edits / deletions in the new file actually take effect. Uncheck only if you want to merge into the previous imports.</>
                  ) : (
                    <>No previous rows yet. This toggle takes effect on future imports — keep it on if you want each new CSV to fully replace the prior one.</>
                  )}
                </div>
              </div>
            </label>
          </div>

          <PreviewTable rows={rows.slice(0, 5)} addressColumn={addressColumn} statusColumn={statusColumn} />

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
              disabled={busy || !addressColumn || !addressSuffix.trim()}
              className="ml-auto inline-flex items-center gap-2 rounded-lg bg-[oklch(78%_0.155_234)] px-4 py-2 font-display text-[12px] font-bold text-[var(--shell-base)] shadow-[0_4px_14px_oklch(78%_0.155_234/0.4)] disabled:opacity-50 transition"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Commit {rows.length} rows → run matching
            </button>
          </div>
        </div>
      )}

      {step === "running" && (
        <ProgressView progress={progress} />
      )}

      {step === "done" && result && (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <CheckCircle2 className="h-10 w-10 text-[oklch(76%_0.16_158)]" />
          <div className="font-display text-[16px] font-extrabold">Import complete</div>
          <div className="text-[12px] text-[var(--shell-text-2)]">
            {result.attempted} rows in this CSV · {result.present_after_import} now stored for this project
            {result.deleted_before_import > 0 && (
              <div className="mt-0.5 font-mono text-[11px] text-[var(--shell-text-muted)]">
                replaced {result.deleted_before_import} row{result.deleted_before_import === 1 ? "" : "s"} from previous imports
              </div>
            )}
            {result.attempted > result.present_after_import && result.deleted_before_import === 0 && (
              <span className="ml-1 text-[var(--shell-text-muted)]">
                ({result.attempted - result.present_after_import} skipped as duplicates of rows already stored)
              </span>
            )}
          </div>
          {result.matcher && (
            <div className="text-[12px] text-[var(--shell-text-2)]">
              {result.matcher.geocoded} geocoded this run
              {result.matcher.snapped_to_parcel > 0 && (
                <> · <b className="text-[var(--shell-text)]">{result.matcher.snapped_to_parcel}</b> snapped to a parcel (50 m)</>
              )}
              {" "}· {result.matcher.matched_now} newly matched to field points
              <div className="mt-1 font-mono text-[11px] text-[var(--shell-text-muted)]">
                M1 {result.matcher.m1_count} · F1 {result.matcher.f1_count} · R1 {result.matcher.r1_count}
              </div>
            </div>
          )}
          {result.matcher_error && (
            <div className="rounded-lg border border-[oklch(68%_0.21_25/0.4)] bg-[oklch(68%_0.21_25/0.08)] px-3 py-2 text-[11px] text-[oklch(68%_0.21_25)]">
              Matcher reported an issue: {result.matcher_error}
              <div className="mt-1 text-[var(--shell-text-muted)]">Click &ldquo;Re-run matching&rdquo; below to retry; the matcher is idempotent.</div>
            </div>
          )}
          {rerunning && progress && (
            <div className="w-full max-w-md">
              <ProgressBar progress={progress} />
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={onRerunMatch}
              disabled={rerunning}
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--shell-border)] bg-[var(--shell-2)] px-4 py-2 font-display text-[12px] font-bold text-[var(--shell-text-2)] hover:bg-[var(--shell-3)] disabled:opacity-50 transition"
            >
              {rerunning && <Loader2 className="h-4 w-4 animate-spin" />}
              Re-run matching
            </button>
            <button onClick={() => router.push(`/p/${projectId}/map`)} className="rounded-lg bg-[oklch(78%_0.155_234)] px-4 py-2 font-display text-[12px] font-bold text-[var(--shell-base)]">View map</button>
            <button onClick={() => { setStep("upload"); setRows([]); setResult(null); }} className="rounded-lg border border-[var(--shell-border)] px-4 py-2 font-display text-[12px] font-bold text-[var(--shell-text-2)]">Import more</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProgressView({ progress }: { progress: Progress | null }) {
  const step = progress?.processing_step ?? "preparing";
  return (
    <div className="flex flex-col items-center gap-4 py-8 text-center">
      <Loader2 className="h-8 w-8 animate-spin text-[oklch(78%_0.155_234)]" />
      <div className="font-display text-[14px] font-bold capitalize">{labelForStep(step)}</div>
      <div className="w-full max-w-md">
        <ProgressBar progress={progress} />
      </div>
      <div className="text-[11px] text-[var(--shell-text-muted)]">
        {step === "geocoding" && "Sending each address to the U.S. Census geocoder (~200 ms per row)."}
        {step === "matching" && "Snapping geocoded responses to field points within 30 meters."}
        {step === "inserting" && "Storing rows and computing dedup hashes."}
        {(!step || step === "preparing") && "Setting up the import…"}
        {step === "done" && "Wrapping up…"}
      </div>
    </div>
  );
}

function ProgressBar({ progress }: { progress: Progress | null }) {
  const done = progress?.processing_done ?? 0;
  const total = progress?.processing_total ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--shell-2)]">
        <div
          className="h-full bg-[oklch(78%_0.155_234)] transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between font-mono text-[11px] text-[var(--shell-text-muted)]">
        <span>{progress?.processing_step ?? "—"}</span>
        <span>{total > 0 ? `${done} / ${total}` : "preparing…"}</span>
      </div>
    </div>
  );
}

function labelForStep(step: string): string {
  switch (step) {
    case "inserting": return "Storing rows…";
    case "geocoding": return "Geocoding addresses…";
    case "matching":  return "Matching to field points…";
    case "done":      return "Finishing…";
    default:          return "Preparing…";
  }
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

function PreviewTable({ rows, addressColumn, statusColumn }: { rows: Row[]; addressColumn: string; statusColumn: string }) {
  if (!rows.length) return null;
  const headers = Object.keys(rows[0]);
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--shell-border)]">
      <table className="w-full text-[11px]">
        <thead className="bg-[var(--shell-2)]">
          <tr>
            {headers.map((h) => (
              <th key={h} className={`whitespace-nowrap px-2 py-1.5 text-left font-bold ${h === addressColumn ? "text-[oklch(78%_0.155_234)]" : h === statusColumn ? "text-[oklch(76%_0.16_158)]" : "text-[var(--shell-text-muted)]"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-[var(--shell-border)]">
              {headers.map((h) => (
                <td key={h} className={`whitespace-nowrap px-2 py-1.5 ${h === addressColumn || h === statusColumn ? "text-[var(--shell-text)]" : "text-[var(--shell-text-2)]"}`}>
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
    if (line.length === 1 && line[0] === "") continue;
    const r: Row = {};
    for (let j = 0; j < headers.length; j++) r[headers[j]] = line[j] ?? "";
    rows.push(r);
  }
  return { headers, rows };
}
