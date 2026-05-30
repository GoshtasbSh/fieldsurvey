import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MoeBracket } from "@/components/analyses/moe-bracket";

describe("MoeBracket", () => {
  it("renders ±MoE in percentage points", () => {
    const { getByText } = render(<MoeBracket successes={50} n={100} confidence={0.95} />);
    expect(getByText(/\d+\.?\d*%/)).toBeTruthy();
  });
  it("hides itself when n < 30", () => {
    const { container } = render(<MoeBracket successes={5} n={10} confidence={0.95} />);
    expect(container.innerHTML).toContain("n too small");
  });
});
