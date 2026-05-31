// tests/analyses/settings-drawer.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsDrawer } from "@/components/analyses/settings-drawer";
import { getCardById } from "@/lib/analyses/registry";
import type { SpatialCardCatalogEntry } from "@/lib/analyses/types";

describe("SettingsDrawer", () => {
  const card = getCardById("S2_gi_star_q") as SpatialCardCatalogEntry;

  it("renders one input per settingsSchema entry", () => {
    render(
      <SettingsDrawer
        open card={card} projectId="p1"
        globalActiveQuestion="Q1"
        settings={{}}
        onChange={() => {}}
        onClose={() => {}}
        onPin={() => {}}
      />
    );
    // Use getAllByText for labels that may also appear in the method description
    expect(screen.getAllByText(/Question/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/FDR alpha/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Spatial weights/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Permutations/i).length).toBeGreaterThan(0);
  });

  it("emits onChange when the slider changes", async () => {
    const u = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SettingsDrawer
        open card={card} projectId="p1"
        globalActiveQuestion="Q1"
        settings={{ fdrAlpha: 0.05 }}
        onChange={onChange}
        onClose={() => {}}
        onPin={() => {}}
      />
    );
    const slider = screen.getByLabelText(/FDR alpha/i);
    await u.click(slider);
    (slider as HTMLInputElement).value = "0.07";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    slider.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onChange).toHaveBeenCalled();
  });
});
