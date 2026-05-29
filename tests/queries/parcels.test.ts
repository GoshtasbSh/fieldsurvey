import { describe, it, expect } from "vitest";
import { boundariesAsFeatureCollection, type BoundaryFeature } from "@/lib/queries/parcels";

describe("boundariesAsFeatureCollection", () => {
  it("wraps each boundary in a Feature with id + name properties", () => {
    const rows: BoundaryFeature[] = [
      {
        id: "11111111-1111-1111-1111-111111111111",
        name: "North block",
        geojson: {
          type: "MultiPolygon",
          coordinates: [[[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]]],
        },
        created_at: "2026-05-29T00:00:00Z",
      },
      {
        id: "22222222-2222-2222-2222-222222222222",
        name: null,
        geojson: { type: "Polygon", coordinates: [[[2, 2], [2, 3], [3, 3], [3, 2], [2, 2]]] },
        created_at: "2026-05-29T01:00:00Z",
      },
    ];

    const fc = boundariesAsFeatureCollection(rows);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0].id).toBe(rows[0].id);
    expect((fc.features[0].properties as { name: string | null }).name).toBe("North block");
    expect(fc.features[1].geometry).toEqual(rows[1].geojson);
  });

  it("returns an empty FeatureCollection for no rows", () => {
    const fc = boundariesAsFeatureCollection([]);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toEqual([]);
  });
});
