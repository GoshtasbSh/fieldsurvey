import { describe, it, expect } from "vitest";
import { wilsonInterval } from "@/lib/analyses/formulas/wilson";

describe("wilsonInterval", () => {
  it("returns wide bounds when n is small", () => {
    const { low, high } = wilsonInterval(5, 10, 0.95);
    expect(low).toBeLessThan(0.5);
    expect(high).toBeGreaterThan(0.5);
    expect(high - low).toBeGreaterThan(0.4);
  });
  it("returns narrow bounds when n is large", () => {
    const { low, high } = wilsonInterval(500, 1000, 0.95);
    expect(high - low).toBeLessThan(0.07);
  });
  it("handles 0 successes", () => {
    const { low, high } = wilsonInterval(0, 100, 0.95);
    expect(low).toBe(0);
    expect(high).toBeGreaterThan(0);
  });
  it("returns 0/0 for n=0", () => {
    const { low, high } = wilsonInterval(0, 0, 0.95);
    expect(low).toBe(0);
    expect(high).toBe(0);
  });
});
