// tests/analyses/wave0-placeholders.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { S2Placeholder } from "@/components/analyses/cards/wave0-placeholders";

describe("Wave 0 placeholders", () => {
  it("renders the Awaiting-data chrome with wave-pending hint", () => {
    render(<S2Placeholder />);
    expect(screen.getByText(/Hot\/Cold Spot/i)).toBeInTheDocument();
    expect(screen.getByText(/Compute backend ships in a later wave/i)).toBeInTheDocument();
  });
});
