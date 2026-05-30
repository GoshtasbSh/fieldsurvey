import { describe, it, expect } from "vitest";
import { computeAaporRates } from "@/lib/analyses/formulas/aapor";

const counts = { I: 200, P: 50, R: 100, NC: 150, O: 30, UH: 60, UO: 40 };

describe("computeAaporRates", () => {
  it("RR1 = I / (I+P+R+NC+O+UH+UO)", () => {
    const { rr1 } = computeAaporRates(counts);
    expect(rr1).toBeCloseTo(200 / 630, 4);
  });
  it("RR3 includes an estimate of eligibility among UH+UO", () => {
    const { rr3 } = computeAaporRates(counts);
    expect(rr3).toBeGreaterThan(0.3);
    expect(rr3).toBeLessThan(0.5);
  });
  it("COOP1 = I / (I+P+R)", () => {
    const { coop1 } = computeAaporRates(counts);
    expect(coop1).toBeCloseTo(200 / 350, 4);
  });
  it("REF1 = R / (I+P+R+NC+O)", () => {
    const { ref1 } = computeAaporRates(counts);
    expect(ref1).toBeCloseTo(100 / 530, 4);
  });
  it("CON1 = (I+P+R+O) / (I+P+R+NC+O+UH+UO)", () => {
    const { con1 } = computeAaporRates(counts);
    expect(con1).toBeCloseTo(380 / 630, 4);
  });
  it("returns nulls for empty universe", () => {
    const r = computeAaporRates({ I: 0, P: 0, R: 0, NC: 0, O: 0, UH: 0, UO: 0 });
    expect(r.rr1).toBeNull();
  });
});
