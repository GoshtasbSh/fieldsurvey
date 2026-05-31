/**
 * Bootstrap-style Monte Carlo on historical daily point counts.
 * Each simulation: draw with replacement from the historical distribution
 * until the cumulative sum reaches `targetRemaining`. Repeat N times.
 * Return the 50/75/90 percentile days-to-finish.
 *
 * Pure deterministic randomness via splitmix32 so unit tests are stable.
 */
function makeRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x9e3779b9) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 16), 0x85ebca6b);
    t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35);
    return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
  };
}

export type Forecast = {
  p50DaysOut: number | null;
  p75DaysOut: number | null;
  p90DaysOut: number | null;
  p50Date: string | null;
  p75Date: string | null;
  p90Date: string | null;
  simulations: number;
  historyWindow: number;
  /**
   * Fraction of simulations that hit the 5-year cap (target unreachable).
   * When > 0.5, callers should treat the forecast as "target may be
   * unreachable" and surface a warning rather than the raw percentile dates.
   */
  truncatedPct: number;
};

export function forecastFinishDate(args: {
  historicalDailyPoints: number[];
  targetRemaining: number;
  startDate: Date;
  simulations?: number;
  seed?: number;
}): Forecast {
  const history = args.historicalDailyPoints.filter((n) => n >= 0);
  const sims = args.simulations ?? 10000;
  if (history.length === 0 || args.targetRemaining <= 0) {
    return {
      p50DaysOut: null, p75DaysOut: null, p90DaysOut: null,
      p50Date: null, p75Date: null, p90Date: null,
      simulations: sims, historyWindow: history.length,
      truncatedPct: 0,
    };
  }
  const rand = makeRng(args.seed ?? 1337);
  const results: number[] = [];
  const cap = 365 * 5;
  let truncated = 0;
  for (let s = 0; s < sims; s++) {
    let cum = 0;
    let days = 0;
    while (cum < args.targetRemaining && days < cap) {
      const idx = Math.floor(rand() * history.length);
      cum += history[idx];
      days++;
    }
    if (days === cap) truncated++;
    results.push(days);
  }
  results.sort((a, b) => a - b);
  const p = (q: number) => results[Math.floor(q * results.length)];
  const p50 = p(0.5), p75 = p(0.75), p90 = p(0.9);
  const date = (d: number) =>
    new Date(args.startDate.getTime() + d * 86400000).toISOString().slice(0, 10);
  return {
    p50DaysOut: p50, p75DaysOut: p75, p90DaysOut: p90,
    p50Date: date(p50), p75Date: date(p75), p90Date: date(p90),
    simulations: sims, historyWindow: history.length,
    truncatedPct: truncated / sims,
  };
}
