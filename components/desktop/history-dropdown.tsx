"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  Clock,
  Loader2,
  CornerDownLeft,
  Calendar,
  X,
  History as HistoryIcon,
} from "lucide-react";

export type AnalysisVersionRow = {
  id: string;
  data_type: string;
  snapshot_at: string;
  trigger: "auto" | "import" | "cron" | "manual";
  delta_summary: Record<string, unknown>;
  is_daily_rollup: boolean;
};

// ── RestoredView context ────────────────────────────────────────────────────
// Provides the currently-active "restored" snapshot to descendants. When
// entered, the provider fetches the full payload by id. Consumers call
// useRestoredPayload(dataType) and prefer that over live data.

type RestoredView = {
  versionId: string;
  projectId: string;
  snapshotAt: string;
  trigger: string;
  /** Loaded after enter() resolves. Shape depends on data_type. */
  payload: unknown | null;
  /** The data_type of the snapshot row itself ("pulse_blob" etc). */
  dataType: string | null;
  loading: boolean;
};

type RestoredViewCtx = {
  active: RestoredView | null;
  enter: (v: { versionId: string; projectId: string; snapshotAt: string; trigger: string }) => Promise<void>;
  exit: () => void;
};

const RestoredViewContext = createContext<RestoredViewCtx>({
  active: null,
  enter: async () => {},
  exit: () => {},
});

export function RestoredViewProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<RestoredView | null>(null);

  const enter = useCallback(
    async (v: { versionId: string; projectId: string; snapshotAt: string; trigger: string }) => {
      setActive({
        versionId: v.versionId,
        projectId: v.projectId,
        snapshotAt: v.snapshotAt,
        trigger: v.trigger,
        payload: null,
        dataType: null,
        loading: true,
      });
      try {
        const res = await fetch(`/api/projects/${v.projectId}/history/${v.versionId}`);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const body = (await res.json()) as {
          version: { payload: unknown; data_type: string };
        };
        setActive({
          versionId: v.versionId,
          projectId: v.projectId,
          snapshotAt: v.snapshotAt,
          trigger: v.trigger,
          payload: body.version.payload,
          dataType: body.version.data_type,
          loading: false,
        });
      } catch {
        // On failure, drop back to live view rather than leaving the banner stuck.
        setActive(null);
      }
    },
    [],
  );

  const value = useMemo<RestoredViewCtx>(
    () => ({
      active,
      enter,
      exit: () => setActive(null),
    }),
    [active, enter],
  );
  return <RestoredViewContext.Provider value={value}>{children}</RestoredViewContext.Provider>;
}

export function useRestoredView() {
  return useContext(RestoredViewContext);
}

/** Compact boolean — true when ANY snapshot is being viewed. */
export function useIsRestored(): boolean {
  return useContext(RestoredViewContext).active !== null;
}

/**
 * Convenience hook for consumers — returns the payload only when the active
 * snapshot's data_type matches `expected`. Otherwise returns null, which the
 * caller treats as "use live data".
 */
export function useRestoredPayload<T = unknown>(expected: string): T | null {
  const { active } = useContext(RestoredViewContext);
  if (!active || active.loading || active.dataType !== expected) return null;
  return active.payload as T;
}

// ── HistoryDropdown ─────────────────────────────────────────────────────────
// Topbar History button opens this panel. List rows render
//   snapshot_at + trigger + delta_summary
// Selecting a row enters restored-view mode.

export function HistoryDropdown({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<AnalysisVersionRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const restored = useRestoredView();

  // Cmd-H / Ctrl-H shortcut
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "h") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/history?limit=50`);
      if (res.ok) {
        const body = await res.json();
        setRows(body.versions ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="bento-focus inline-flex items-center gap-1.5 rounded-[10px] border border-[var(--bento-rule)] bg-[var(--bento-surface)] px-2.5 py-[7px] text-[12px] font-medium text-[var(--bento-ink-2)] transition hover:bg-[var(--bento-surface-3)] hover:text-[var(--bento-ink-1)]"
        aria-label="History"
        title="History · ⌘H"
      >
        <Clock className="h-3.5 w-3.5" strokeWidth={1.8} />
        <span>History</span>
        <kbd className="ml-1 rounded border border-[var(--bento-rule)] bg-[var(--bento-surface-2)] px-1 font-mono text-[9.5px] text-[var(--bento-ink-3)]">
          ⌘H
        </kbd>
      </button>

      {open && (
        <>
          {/* Click-outside scrim — transparent, just to catch clicks */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            className="absolute right-0 top-[calc(100%+8px)] z-50 w-[420px] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="bento-panel bento-panel-lift"
              style={{ borderRadius: "var(--bento-radius-lg)" }}
            >
              <div className="flex items-center justify-between border-b border-[var(--bento-rule)] px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <HistoryIcon
                    className="h-3.5 w-3.5"
                    strokeWidth={2}
                    style={{ color: "var(--bento-accent)" }}
                  />
                  <span className="font-display text-[13px] font-bold">History</span>
                  <span className="bento-chip" style={{ padding: "1px 6px", fontSize: "10px" }}>
                    {(rows?.length ?? 0)} snapshots
                  </span>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--bento-ink-3)] hover:bg-[var(--bento-surface-3)]"
                  aria-label="Close"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              </div>

              <div className="max-h-[420px] overflow-y-auto p-2">
                {loading && rows === null && (
                  <div className="flex items-center justify-center gap-2 px-4 py-6 text-[12px] text-[var(--bento-ink-3)]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                    Loading history…
                  </div>
                )}
                {!loading && rows !== null && rows.length === 0 && (
                  <div className="px-4 py-8 text-center text-[12px] text-[var(--bento-ink-3)]">
                    No snapshots yet. They&apos;ll appear here after each cache refresh.
                    <div className="mt-1 font-mono text-[10.5px] opacity-70">
                      (Cache writer arrives in M4-2.)
                    </div>
                  </div>
                )}
                {(rows ?? []).map((r) => {
                  const isCurrent = restored.active?.versionId === r.id;
                  return (
                    <button
                      key={r.id}
                      onClick={() => {
                        void restored.enter({
                          versionId: r.id,
                          projectId,
                          snapshotAt: r.snapshot_at,
                          trigger: r.trigger,
                        });
                        setOpen(false);
                      }}
                      className={`flex w-full flex-col items-start gap-1 rounded-[10px] px-3 py-2.5 text-left transition ${
                        isCurrent ? "" : "hover:bg-[var(--bento-surface-2)]"
                      }`}
                      style={
                        isCurrent
                          ? { background: "var(--bento-accent-soft)" }
                          : undefined
                      }
                    >
                      <div className="flex w-full items-baseline justify-between">
                        <div className="flex items-center gap-2">
                          <Calendar
                            className="h-3 w-3"
                            strokeWidth={2}
                            style={{
                              color: isCurrent
                                ? "var(--bento-accent)"
                                : "var(--bento-ink-3)",
                            }}
                          />
                          <span className="text-[12.5px] font-semibold text-[var(--bento-ink-1)]">
                            {new Date(r.snapshot_at).toLocaleString(undefined, {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })}
                          </span>
                        </div>
                        <TriggerBadge trigger={r.trigger} isRollup={r.is_daily_rollup} />
                      </div>
                      <DeltaSummary delta={r.delta_summary} />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function TriggerBadge({
  trigger,
  isRollup,
}: {
  trigger: AnalysisVersionRow["trigger"];
  isRollup: boolean;
}) {
  const styles: Record<string, { bg: string; color: string; label: string }> = {
    auto: { bg: "var(--bento-surface-2)", color: "var(--bento-ink-3)", label: "auto" },
    import: { bg: "var(--bento-accent-soft)", color: "var(--bento-accent)", label: "import" },
    cron: { bg: "var(--bento-warning-soft)", color: "var(--bento-warning)", label: "cron" },
    manual: { bg: "var(--bento-success-soft)", color: "var(--bento-success)", label: "manual" },
  };
  const s = styles[trigger] ?? styles.auto;
  return (
    <span className="flex items-center gap-1">
      <span
        className="rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider"
        style={{ background: s.bg, color: s.color }}
      >
        {s.label}
      </span>
      {isRollup && (
        <span
          className="rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider"
          style={{ background: "var(--bento-magenta-soft)", color: "var(--bento-magenta)" }}
        >
          daily
        </span>
      )}
    </span>
  );
}

function DeltaSummary({ delta }: { delta: Record<string, unknown> }) {
  const parts: string[] = [];
  if (typeof delta?.new_points === "number" && delta.new_points > 0)
    parts.push(`+${delta.new_points} points`);
  if (typeof delta?.new_responses === "number" && delta.new_responses > 0)
    parts.push(`+${delta.new_responses} responses`);
  if (typeof delta?.status_changes === "number" && delta.status_changes > 0)
    parts.push(`${delta.status_changes} status changes`);
  if (typeof delta?.imports === "number" && delta.imports > 0)
    parts.push(`${delta.imports} import${delta.imports === 1 ? "" : "s"}`);
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-[var(--bento-ink-3)]">
      <CornerDownLeft className="h-2.5 w-2.5" strokeWidth={2} />
      <span>{parts.length > 0 ? parts.join(" · ") : "no measurable delta"}</span>
    </div>
  );
}

// ── RestoredViewBanner — sticky banner at the top of the dashboard ──────────
export function RestoredViewBanner() {
  const { active, exit } = useRestoredView();
  if (!active) return null;
  return (
    <div
      className="flex items-center justify-between gap-3 border-b px-4 py-2 text-[12px]"
      style={{
        background: "var(--bento-accent-soft)",
        borderColor: "var(--bento-accent)",
        color: "var(--bento-accent)",
      }}
    >
      <div className="flex items-center gap-2">
        <Clock className="h-3.5 w-3.5" strokeWidth={2} />
        <span className="font-semibold">
          Viewing snapshot from{" "}
          {new Date(active.snapshotAt).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </span>
        <span style={{ color: "var(--bento-ink-3)" }}>
          · trigger: {active.trigger}
        </span>
      </div>
      <button
        onClick={exit}
        className="bento-focus inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition hover:bg-[var(--bento-accent-quiet)]"
      >
        <X className="h-3 w-3" strokeWidth={2.5} />
        Exit restored view
      </button>
    </div>
  );
}
