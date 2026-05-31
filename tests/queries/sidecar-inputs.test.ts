import { describe, it, expect } from "vitest";
import { inferType } from "@/lib/colorize/auto-classify";

describe("spatial cell encoding logic", () => {
  it("infers likert type correctly", () => {
    const r = inferType(["strongly agree","agree","neutral","disagree","strongly disagree"]);
    expect(r.type).toBe("likert");
    expect(r.likertOrder).toBeDefined();
  });

  it("infers boolean type correctly", () => {
    const r = inferType(["yes","no","yes","yes","no"]);
    expect(r.type).toBe("boolean");
  });

  it("infers numeric_continuous correctly", () => {
    const vals = Array.from({length: 20}, (_, i) => i + 1);
    const r = inferType(vals);
    expect(["numeric_continuous","numeric_skewed"]).toContain(r.type);
  });
});
