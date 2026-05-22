import { describe, it, expect, vi, beforeEach } from "vitest";
import { geocodeAddress } from "./geocode";

const ok = (data: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) } as Response);

beforeEach(() => { vi.restoreAllMocks(); });

describe("geocodeAddress", () => {
  it("returns first Nominatim result", async () => {
    vi.spyOn(global, "fetch").mockReturnValue(
      ok([{ lat: "29.6516", lon: "-82.3248", display_name: "Gainesville, FL" }]),
    );
    const r = await geocodeAddress("Gainesville FL");
    expect(r).toEqual({ lat: 29.6516, lon: -82.3248, displayName: "Gainesville, FL" });
  });

  it("returns null when no results", async () => {
    vi.spyOn(global, "fetch").mockReturnValue(ok([]));
    expect(await geocodeAddress("zzzzz")).toBeNull();
  });
});
