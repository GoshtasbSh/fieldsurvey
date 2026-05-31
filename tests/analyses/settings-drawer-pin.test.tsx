// tests/analyses/settings-drawer-pin.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsDrawer } from "@/components/analyses/settings-drawer";
import { getCardById } from "@/lib/analyses/registry";
import type { SpatialCardCatalogEntry } from "@/lib/analyses/types";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("SettingsDrawer — run + pin", () => {
  const card = getCardById("S2_gi_star_q") as SpatialCardCatalogEntry;

  it("Run analysis button triggers fetch and shows result panel", async () => {
    const u = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: { cells: [], fdrCutoff: 0.05, nSigHot: 2, nSigCold: 1 },
        computedAt: "2026-05-31T10:00:00Z",
      }),
    });

    render(
      <SettingsDrawer
        open card={card} projectId="p1"
        globalActiveQuestion="Q1"
        settings={{ fdrAlpha: 0.05 }}
        onChange={() => {}}
        onClose={() => {}}
        onPin={() => {}}
      />
    );

    await u.click(screen.getByRole("button", { name: /run analysis/i }));
    await waitFor(() => {
      expect(screen.getByText(/result/i)).toBeInTheDocument();
    });
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining("/analyses/S2_gi_star_q"));
  });

  it("Pin to left panel button calls onPin with the result data", async () => {
    const u = userEvent.setup();
    const onPin = vi.fn();
    const resultPayload = { cells: [], fdrCutoff: 0.05, nSigHot: 3, nSigCold: 0 };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: resultPayload, computedAt: "2026-05-31T10:00:00Z" }),
    });

    render(
      <SettingsDrawer
        open card={card} projectId="p1"
        globalActiveQuestion="Q1"
        settings={{ fdrAlpha: 0.05 }}
        onChange={() => {}}
        onClose={() => {}}
        onPin={onPin}
      />
    );

    await u.click(screen.getByRole("button", { name: /run analysis/i }));
    await waitFor(() => screen.getByRole("button", { name: /pin to left panel/i }));
    await u.click(screen.getByRole("button", { name: /pin to left panel/i }));
    expect(onPin).toHaveBeenCalledWith(resultPayload);
  });
});
