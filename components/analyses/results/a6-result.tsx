// components/analyses/results/a6-result.tsx
"use client";
type Term = { term: string; count: number; pct: number };
type D = { unigrams: Term[]; bigrams: Term[]; n_text: number; pct_empty: number };
export function A6Result({ data }: { data: unknown }) {
  const r = data as D;
  if (!r?.unigrams) return null;
  const allTerms = [...r.unigrams, ...r.bigrams];
  const maxCount = Math.max(...allTerms.map(t => t.count), 1);
  const renderTerms = (terms: Term[], label: string) => (
    <div className="space-y-1">
      <p className="text-[10px] font-mono text-[var(--shell-text-muted)] uppercase tracking-wide">{label}</p>
      {terms.slice(0, 8).map((t, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-[var(--shell-text-muted)] w-20 truncate flex-shrink-0">{t.term}</span>
          <div className="flex-1 h-2 bg-[var(--shell-2)] rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${(t.count / maxCount) * 100}%` }} />
          </div>
          <span className="text-[10px] text-[var(--shell-text-muted)] w-6 text-right flex-shrink-0">{t.count}</span>
        </div>
      ))}
    </div>
  );
  return (
    <div className="space-y-3">
      <p className="text-[10px] text-[var(--shell-text-muted)]">n = {r.n_text} · {(r.pct_empty * 100).toFixed(1)}% empty</p>
      {r.unigrams.length > 0 && renderTerms(r.unigrams, "Unigrams")}
      {r.bigrams.length > 0 && renderTerms(r.bigrams, "Bigrams")}
    </div>
  );
}
