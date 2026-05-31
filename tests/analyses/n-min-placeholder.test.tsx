import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { NMinPlaceholder } from "@/components/analyses/n-min-placeholder";

describe("NMinPlaceholder", () => {
  it("renders 'N more needed' with progress", () => {
    const { getByText } = render(<NMinPlaceholder cardName="AAPOR rates" n={20} nMin={50} />);
    expect(getByText(/30 more/i)).toBeTruthy();
    expect(getByText(/AAPOR rates/i)).toBeTruthy();
  });
  it("clamps at 100% when n >= nMin", () => {
    const { container } = render(<NMinPlaceholder cardName="X" n={100} nMin={50} />);
    expect(container.innerHTML).toContain("100%");
  });
});
