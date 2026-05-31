// tests/analyses/analysis-layers-panel.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnalysisLayersPanel } from "@/components/analyses/analysis-layers-panel";
import type { PinnedAnalysisLayer } from "@/lib/analyses/types";

const layers: PinnedAnalysisLayer[] = [
  { cardId: "S2_gi_star_q", layerName: "Hot spots", settings: {}, visible: true, pinnedAt: "2026-05-31T10:00:00Z" },
  { cardId: "S6_coverage_response", layerName: "Coverage", settings: {}, visible: false, pinnedAt: "2026-05-31T10:05:00Z" },
];

describe("AnalysisLayersPanel", () => {
  it("renders empty state when no layers pinned", () => {
    render(
      <AnalysisLayersPanel
        layers={[]} loading={false}
        onToggleVisibility={() => {}}
        onUnpin={() => {}}
        onOpenSettings={() => {}}
        onRename={() => {}}
      />
    );
    expect(screen.getByText(/no analysis layers pinned/i)).toBeInTheDocument();
  });

  it("renders one row per pinned layer with layer name", () => {
    render(
      <AnalysisLayersPanel
        layers={layers} loading={false}
        onToggleVisibility={() => {}}
        onUnpin={() => {}}
        onOpenSettings={() => {}}
        onRename={() => {}}
      />
    );
    expect(screen.getByText("Hot spots")).toBeInTheDocument();
    expect(screen.getByText("Coverage")).toBeInTheDocument();
  });

  it("eye toggle button calls onToggleVisibility", async () => {
    const u = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <AnalysisLayersPanel
        layers={layers} loading={false}
        onToggleVisibility={onToggle}
        onUnpin={() => {}}
        onOpenSettings={() => {}}
        onRename={() => {}}
      />
    );
    const toggles = screen.getAllByRole("button", { name: /toggle visibility/i });
    await u.click(toggles[0]);
    expect(onToggle).toHaveBeenCalledWith("S2_gi_star_q", "2026-05-31T10:00:00Z", false);
  });

  it("⚙ button calls onOpenSettings", async () => {
    const u = userEvent.setup();
    const onOpenSettings = vi.fn();
    render(
      <AnalysisLayersPanel
        layers={layers} loading={false}
        onToggleVisibility={() => {}}
        onUnpin={() => {}}
        onOpenSettings={onOpenSettings}
        onRename={() => {}}
      />
    );
    const cogs = screen.getAllByRole("button", { name: /settings/i });
    await u.click(cogs[0]);
    expect(onOpenSettings).toHaveBeenCalledWith("S2_gi_star_q", "2026-05-31T10:00:00Z");
  });
});
