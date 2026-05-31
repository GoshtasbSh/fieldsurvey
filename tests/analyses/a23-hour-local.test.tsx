import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { HourHistogram } from "@/components/analyses/cards/a23-hour-local";

describe("HourHistogram", () => {
  it("renders 24 bars", () => {
    const buckets = Array.from({ length: 24 }, (_, h) => ({ hour: h, total: h }));
    const { container } = render(<HourHistogram buckets={buckets} tz="America/New_York" />);
    expect(container.querySelectorAll(".grid-cols-24 > div").length).toBe(24);
  });
  it("renders AwaitingDataPanel for undefined buckets", () => {
    const { container } = render(<HourHistogram />);
    expect(container.textContent).toContain("Awaiting data");
  });
  it("renders AwaitingDataPanel for empty buckets", () => {
    const { container } = render(<HourHistogram buckets={[]} />);
    expect(container.textContent).toContain("Awaiting data");
  });
});
