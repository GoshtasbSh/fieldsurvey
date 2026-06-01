import { describe, it, expect, afterEach, vi } from "vitest";

// We don't actually want sharp to run during the unit test — stub the
// generator's two dependencies (fetch + sharp) and assert the tile math.

describe("thumb generator", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    vi.resetModules();
  });

  it("requests four imagery tiles and no labels overlay", async () => {
    const seen: string[] = [];
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      seen.push(String(url));
      // Return a 1x1 transparent PNG (75 bytes) so sharp can consume it.
      const onePxPng = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      );
      return new Response(onePxPng, {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }) as typeof fetch;

    const { generateProjectThumb } = await import("@/lib/thumb/generate");
    const out = await generateProjectThumb({
      centerLat: 29.13,
      centerLon: -83.03,
      zoom: 11,
      width: 480,
      height: 280,
    });

    // Labels are now composed in CSS by the card — the generator only
    // fetches the four imagery tiles around the centre.
    expect(seen).toHaveLength(4);
    for (const u of seen) {
      expect(u).toMatch(
        /^https:\/\/server\.arcgisonline\.com\/ArcGIS\/rest\/services\/World_Imagery\/MapServer\/tile\/11\/\d+\/\d+$/,
      );
    }
    expect(seen.filter((u) => u.includes("World_Boundaries_and_Places"))).toHaveLength(0);
    expect(out.width).toBe(480);
    expect(out.height).toBe(280);
    expect(out.zoom).toBe(11);
    expect(out.png.length).toBeGreaterThan(0);
  });

  it("wraps tile X at the antimeridian", async () => {
    const xValues: number[] = [];
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      // ESRI URL order is /z/y/x — the second number is x.
      const m = String(url).match(/\/tile\/11\/\d+\/(\d+)$/);
      if (m) xValues.push(parseInt(m[1], 10));
      const onePx = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      );
      return new Response(onePx, { status: 200, headers: { "content-type": "image/png" } });
    }) as typeof fetch;

    const { generateProjectThumb } = await import("@/lib/thumb/generate");
    await generateProjectThumb({
      centerLat: 0,
      centerLon: 179.9, // near antimeridian
      zoom: 11,
    });

    // 2^11 = 2048; X values must be in [0, 2048).
    for (const x of xValues) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(2048);
    }
  });
});
