// tests/analyses/analyses-list-item.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnalysesListItem } from "@/components/analyses/analyses-list-item";
import type { AnalysisListItem } from "@/lib/analyses/types";

const item: AnalysisListItem = {
  cardId: "S2_gi_star_q",
  settings: {},
  addedAt: "2026-05-31T10:00:00Z",
};

describe("AnalysesListItem", () => {
  it("clicking the card body opens settings", async () => {
    const u = userEvent.setup();
    const onOpenSettings = vi.fn();
    render(
      <AnalysesListItem
        item={item} projectId="p1" globalActiveQuestion={null}
        onOpenSettings={onOpenSettings} onRemove={() => {}}
      />
    );
    await u.click(screen.getByText(/Hot\/Cold Spot/i));
    expect(onOpenSettings).toHaveBeenCalledWith("S2_gi_star_q");
  });

  it("the ⚙ icon is present visually", () => {
    render(
      <AnalysesListItem
        item={item} projectId="p1" globalActiveQuestion={null}
        onOpenSettings={() => {}} onRemove={() => {}}
      />
    );
    // aria-hidden span contains ⚙ — it should be present in DOM even if hidden
    expect(document.querySelector('[aria-hidden]')).not.toBeNull();
  });
});
