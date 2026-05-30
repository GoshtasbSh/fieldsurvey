import { describe, it, expect } from "vitest";
import { forecastFinishDate } from "@/lib/analyses/formulas/monte-carlo";

describe("forecastFinishDate", () => {
  it("returns 50/75/90 percentile dates given a target and history", () => {
    const history = Array.from({ length: 30 }, () => 5);
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
});
