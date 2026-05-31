import { describe, it, expect } from "vitest";
import { computeAaporRates } from "@/lib/analyses/formulas/aapor";

const counts = { I: 200, P: 50, R: 100, NC: 150, O: 30, UH: 60, UO: 40 };

describe("computeAaporRates", () => {
  it("RR1 = I / (I+P+R+NC+O+UH+UO)", () => {
    const { rr1 } = computeAaporRates(counts);
    expect(rr1).toBeCloseTo(200 / 630, 4);
  });
  it("RR3 sits between RR1 and RR5 (eligibility-adjusted)", () => {
    const { rr1, rr3, rr5 } = computeAaporRates(counts);
    expect(rr1).not.toBeNull();
    expect(rr3).not.toBeNull();
    expect(rr5).not.toBeNull();
    expect(rr3!).toBeGreaterThan(rr1!);
    expect(rr3!).toBeLessThan(rr5!);
    expect(rr3!).toBeCloseTo(0.3203, 3);
  });
  it("COOP1 = I / (I+P+R)", () => {
    const { coop1 } = computeAaporRates(counts);
    expect(coop1).toBeCloseTo(200 / 350, 4);
  });
  it("REF1 = R / (I+P+R+NC+O+UH+UO) — full AAPOR denominator", () => {
    const { ref1 } = computeAaporRates(counts);
    expect(ref1).toBeCloseTo(100 / 630, 4);
  });
  it("CON1 = (I+P+R+O) / (I+P+R+NC+O+UH+UO)", () => {
    const { con1 } = computeAaporRates(counts);
    expect(con1).toBeCloseTo(380 / 630, 4);
  });
  it("returns nulls for empty universe", () => {
    const r = computeAaporRates({ I: 0, P: 0, R: 0, NC: 0, O: 0, UH: 0, UO: 0 });
    expect(r.rr1).toBeNull();
  });
  it("UNMAPPED is EXCLUDED from every denominator and surfaced as count", () => {
    const withUnmapped = { ...counts, UNMAPPED: 50 };
    const rWith = computeAaporRates(withUnmapped);
    const rWithout = computeAaporRates(counts);
    // Every rate should be IDENTICAL whether or not 50 UNMAPPED rows exist.
    expect(rWith.rr1).toBeCloseTo(rWithout.rr1 ?? -1, 10);
    expect(rWith.rr3).toBeCloseTo(rWithout.rr3 ?? -1, 10);
    expect(rWith.rr5).toBeCloseTo(rWithout.rr5 ?? -1, 10);
    expect(rWith.coop1).toBeCloseTo(rWithout.coop1 ?? -1, 10);
    expect(rWith.ref1).toBeCloseTo(rWithout.ref1 ?? -1, 10);
    expect(rWith.con1).toBeCloseTo(rWithout.con1 ?? -1, 10);
    // …but the count is preserved on the rates object for UI display.
    expect(rWith.unmappedCount).toBe(50);
    expect(rWithout.unmappedCount).toBe(0);
  });
});
