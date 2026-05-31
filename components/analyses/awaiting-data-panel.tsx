// Shared "Awaiting data" panel for any registry card whose query returns
// empty / null / sidecar_pending. Lets admins SEE which catalog cards are
// wired before real data flows. Once data arrives, the card swaps to its
// real viz body — no extra wiring needed.

type Props = {
  cardName: string;
  cardId?: string;
  reason?: "no-data" | "needs-universe" | "needs-aapor-mapping" | "needs-demographics" | "needs-boundary" | "sidecar-pending";
};

const REASON_HINT: Record<NonNullable<Props["reason"]>, string> = {
  "no-data": "No data collected for this card yet. Cards stay hidden until n ≥ minimum.",
  "needs-universe": "Upload a universe CSV (left rail → Universe) to enable coverage analysis.",
  "needs-aapor-mapping": "Map each project status to an AAPOR outcome (Settings → AAPOR mapping).",
  "needs-demographics": "Declare demographic stratifier columns to enable representativeness.",
  "needs-boundary": "Draw a project boundary (left rail → Boundary) to enable spatial filters.",
  "sidecar-pending": "Python sidecar not deployed yet — see runbook.",
};

export function AwaitingDataPanel({ cardName, cardId, reason = "no-data" }: Props) {
  return (
    <div className="bento-panel p-4 opacity-90">
      <div className="bento-label mb-1.5 flex items-center justify-between">
        <span>{cardName}</span>
        {cardId && <span className="font-mono text-[9px] text-[var(--shell-text-muted)]">{cardId}</span>}
      </div>
      <div className="text-[11px] leading-snug text-[var(--shell-text-muted)]">
        {REASON_HINT[reason]}
      </div>
      <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-[var(--shell-border)] bg-[var(--shell-2)] px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.06em] text-[var(--shell-text-muted)]">
        ◌ Awaiting data
      </div>
    </div>
  );
}
