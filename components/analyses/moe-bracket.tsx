import { wilsonInterval } from "@/lib/analyses/formulas/wilson";

type Props = { successes: number; n: number; confidence?: 0.9 | 0.95 | 0.99 };

export function MoeBracket({ successes, n, confidence = 0.95 }: Props) {
  if (n < 30) return <span className="font-mono text-[9px] text-[var(--shell-text-muted)]">n too small</span>;
  const { low, high } = wilsonInterval(successes, n, confidence);
  const half = ((high - low) / 2) * 100;
  return (
    <span className="font-mono text-[9.5px] text-[var(--shell-text-muted)]">±{half.toFixed(1)}%</span>
  );
}
