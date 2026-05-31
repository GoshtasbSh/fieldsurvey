import { describe, it, expect } from "vitest";
import { jenksBreaks, quantileBreaks, equalIntervalBreaks } from "@/lib/colorize/auto-classify";

describe("classification breaks edge cases", () => {
  it("jenks handles n=1, k=5", () => {
    const breaks = jenksBreaks([42], 5);
    expect(breaks.length).toBe(0); // 1 unique - 1 = 0 breaks
  });
  it("jenks handles n=3, k=5", () => {
    const breaks = jenksBreaks([1, 5, 10], 5);
    expect(breaks.length).toBeLessThanOrEqual(2);
    expect(breaks.every((b) => Number.isFinite(b))).toBe(true);
  });
  it("jenks normal case", () => {
    const breaks = jenksBreaks(Array.from({ length: 100 }, (_, i) => i), 5);
    expect(breaks.length).toBe(4);
  });
  it("quantile breaks k-1 sized", () => {
    const breaks = quantileBreaks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
    expect(breaks.length).toBe(4);
  });
  it("equal-interval breaks k-1 sized", () => {
    const breaks = equalIntervalBreaks(0, 100, 5);
    expect(breaks).toEqual([20, 40, 60, 80]);
  });
});
