// tests/analyses/add-analysis-modal.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddAnalysisModal } from "@/components/analyses/add-analysis-modal";

vi.mock("next/image", () => ({
  default: ({ src, alt, ...rest }: { src: string; alt: string }) => <img src={src} alt={alt} {...rest} />,
}));

describe("AddAnalysisModal", () => {
  it("renders core v1 toolbox names when open", () => {
    render(<AddAnalysisModal open onOpenChange={() => {}} onAdd={() => {}} />);
    expect(screen.getByText(/Symbology & Visualization/)).toBeInTheDocument();
    expect(screen.getByText(/Analyzing Patterns/)).toBeInTheDocument();
    expect(screen.getByText(/Mapping Clusters/)).toBeInTheDocument();
    expect(screen.getByText(/Modeling Spatial Relationships/)).toBeInTheDocument();
    expect(screen.getByText(/Survey Coverage & Equity/)).toBeInTheDocument();
  });

  it("renders formerly-V2 toolboxes as regular v1 toolboxes (all promoted)", () => {
    render(<AddAnalysisModal open onOpenChange={() => {}} onAdd={() => {}} />);
    // All three former-V2 toolboxes are now in the main toolbox list
    expect(screen.getByText(/Space-Time Pattern Mining/)).toBeInTheDocument();
    expect(screen.getByText(/Spatial Regression/)).toBeInTheDocument();
    expect(screen.getByText(/Sampling Equity/)).toBeInTheDocument();
  });

  it("clicking a v1 toolbox shows its cards", async () => {
    const u = userEvent.setup();
    render(<AddAnalysisModal open onOpenChange={() => {}} onAdd={() => {}} />);
    await u.click(screen.getByText(/Mapping Clusters/));
    expect(screen.getByText(/Hot\/Cold Spot/i)).toBeInTheDocument();
    expect(screen.getByText(/Cluster & Outlier/i)).toBeInTheDocument();
  });

  it("clicking Add on a card calls onAdd with the card id", async () => {
    const u = userEvent.setup();
    const onAdd = vi.fn();
    render(<AddAnalysisModal open onOpenChange={() => {}} onAdd={onAdd} />);
    await u.click(screen.getByText(/Mapping Clusters/));
    const cards = screen.getAllByRole("button", { name: /Add .* to Analyze tab/i });
    await u.click(cards[0]);
    expect(onAdd).toHaveBeenCalledWith(expect.stringMatching(/^S[2347]_/));
  });
});
