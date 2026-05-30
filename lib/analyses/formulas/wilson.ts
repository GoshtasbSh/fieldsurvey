/** Wilson score interval for a binomial proportion. */
export function wilsonInterval(successes: number, n: number, confidence = 0.95): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 0 };
  if (successes < 0 || successes > n) return { low: 0, high: 1 };
  const z = confidence === 0.99 ? 2.576 : confidence === 0.9 ? 1.645 : 1.96;
  const p = Math.min(1, Math.max(0, successes / n));
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return {
    low: Math.max(0, centre - margin),
    high: Math.min(1, centre + margin),
  };
}
