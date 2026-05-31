import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { RegistryCard } from "@/components/analyses/registry-card";

describe("RegistryCard", () => {
  it("renders the matching viz component for a known card id", async () => {
    const { findByText } = render(<RegistryCard cardId="A39_freshness" projectId="p1" userRole="member" />);
    expect(await findByText(/freshness/i)).toBeTruthy();
  });
  it("falls back to a Coming placeholder for stubs", async () => {
    const { findByText } = render(<RegistryCard cardId="A30_time_per_stop" projectId="p1" userRole="admin" />);
    expect(await findByText(/coming/i)).toBeTruthy();
  });
});
