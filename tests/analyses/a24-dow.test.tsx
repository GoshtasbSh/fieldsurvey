import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { DowHourHeatmap } from "@/components/analyses/cards/a24-dow-heatmap";

describe("DowHourHeatmap", () => {
  it("renders 7*24 cells", () => {
    const cells = Array.from({ length: 7 * 24 }, (_, i) => ({
      dow: Math.floor(i / 24),
      hour: i % 24,
      count: i,
    }));
    const { container } = render(<DowHourHeatmap cells={cells} tz="UTC" />);
    expect(container.querySelectorAll("div.aspect-square").length).toBe(7 * 24);
  });
  it("renders AwaitingDataPanel for undefined cells", () => {
    const { container } = render(<DowHourHeatmap />);
    expect(container.textContent).toContain("Awaiting data");
  });
});
