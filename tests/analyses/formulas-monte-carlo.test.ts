import { describe, it, expect } from "vitest";
import { forecastFinishDate } from "@/lib/analyses/formulas/monte-carlo";

const history = [3, 5, 7, 10, 2, 8, 4, 6, 5, 9, 3, 7, 5, 4, 8, 6, 2, 10, 5, 6, 3, 7, 4, 8, 5, 6, 9, 2, 5, 7];

describe("forecastFinishDate", () => {
  it("returns 50/75/90 percentile dates given a target and history", () => {
    const r = forecastFinishDate({
      historicalDailyPoints: history,
      targetRemaining: 100,
      startDate: new Date("2026-06-01T00:00:00Z"),
      simulations: 5000,
    });
    expect(r.p50DaysOut).toBeGreaterThan(15);
    expect(r.p50DaysOut).toBeLessThan(25);
    if (r.p90DaysOut != null && r.p50DaysOut != null) {
      expect(r.p90DaysOut).toBeGreaterThanOrEqual(r.p50DaysOut);
    }
  });
  it("handles zero history with null", () => {
    const r = forecastFinishDate({
      historicalDailyPoints: [],
      targetRemaining: 100,
      startDate: new Date("2026-06-01T00:00:00Z"),
      simulations: 1000,
    });
    expect(r.p50DaysOut).toBeNull();
  });
  it("returns deterministic results for fixed seed", () => {
    const args = {
      historicalDailyPoints: history,
      targetRemaining: 100,
      startDate: new Date("2026-06-01T00:00:00Z"),
      simulations: 1000,
      seed: 42,
    };
    const a = forecastFinishDate(args);
    const b = forecastFinishDate(args);
    expect(a.p50DaysOut).toBe(b.p50DaysOut);
    expect(a.p75DaysOut).toBe(b.p75DaysOut);
  });
});
