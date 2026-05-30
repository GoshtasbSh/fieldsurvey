export function NMinPlaceholder({ cardName, n, nMin }: { cardName: string; n: number; nMin: number }) {
  const remaining = Math.max(0, nMin - n);
  const pct = Math.min(100, Math.round((n / Math.max(1, nMin)) * 100));
  return (
    <div className="bento-panel p-4">
      <div className="bento-label mb-2">{cardName}</div>
      <div className="text-[11.5px] leading-snug text-[var(--shell-text-muted)]">
        Need {remaining} more responses for this analysis to be reliable.
        You have {n} of {nMin}.
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-[var(--shell-3)]">
          <div className="h-full rounded-full bg-[var(--shell-text-muted)]" style={{ width: `${pct}%` }} />
        </div>
        <span className="font-mono text-[10px] tabular-nums text-[var(--shell-text-muted)]">{pct}%</span>
      </div>
    </div>
  );
}
