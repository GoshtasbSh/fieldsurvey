// tests/analyses/analyses-list.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnalysesList } from "@/components/analyses/analyses-list";
import type { AnalysisListItem } from "@/lib/analyses/types";

const items: AnalysisListItem[] = [
  { cardId: "S2_gi_star_q", settings: {}, addedAt: "2026-05-30T12:00:00Z" },
  { cardId: "S6_coverage_response", settings: {}, addedAt: "2026-05-30T12:05:00Z" },
];

describe("AnalysesList", () => {
  it("renders an empty state when items is []", () => {
    render(<AnalysesList items={[]} projectId="p1" globalActiveQuestion={null} onOpenSettings={() => {}} onRemove={() => {}} onAddClick={() => {}} />);
    expect(screen.getByText(/no spatial analyses added/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add spatial analysis/i })).toBeInTheDocument();
  });

  it("renders one row per item with card name + status", () => {
    render(<AnalysesList items={items} projectId="p1" globalActiveQuestion={null} onOpenSettings={() => {}} onRemove={() => {}} onAddClick={() => {}} />);
    expect(screen.getByText(/Hot\/Cold Spot/i)).toBeInTheDocument();
    expect(screen.getByText(/Coverage × Response/i)).toBeInTheDocument();
  });

  it("clicking the settings cog emits onOpenSettings with the cardId", async () => {
    const u = userEvent.setup();
    const onOpenSettings = vi.fn();
    render(<AnalysesList items={items} projectId="p1" globalActiveQuestion={null} onOpenSettings={onOpenSettings} onRemove={() => {}} onAddClick={() => {}} />);
    const cogs = screen.getAllByRole("button", { name: /open settings/i });
    await u.click(cogs[0]);
    expect(onOpenSettings).toHaveBeenCalledWith("S2_gi_star_q");
  });
});
