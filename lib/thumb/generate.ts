/**
 * Server-side /home thumbnail generator (M8).
 *
 * Stitches four Carto Dark Matter raster tiles around a project's center
 * point into a single PNG. The result is uploaded to the
 * `project-thumbs` Supabase Storage bucket by the caller; this module
 * only produces the bytes.
 *
 * Why this approach:
 *   - No headless browser. No Mapbox key. No external static-map service.
 *   - One round-trip per tile (4 fetches), then a single sharp composite.
 *   - Output is 480×280 by default — the size used by /home cards.
 *
 * Why Carto Dark Matter:
 *   - Same look as the in-app dashboards, so the thumb is recognisable.
 *   - Public, no API key, generous fair-use for low volumes.
 */

import "server-only";
import sharp from "sharp";

export type ThumbOptions = {
  centerLat: number;
  centerLon: number;
  zoom?: number;
  width?: number;
  height?: number;
};

export type ThumbResult = {
  png: Buffer;
  width: number;
  height: number;
  centerLat: number;
  centerLon: number;
  zoom: number;
};

const TILE_SIZE = 256;
const CARTO_HOSTS = ["a", "b", "c", "d"];

/** XY tile coords (fractional). */
function lonLatToTile(lon: number, lat: number, z: number): { x: number; y: number } {
  const sin = Math.sin((lat * Math.PI) / 180);
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.log((1 + sin) / (1 - sin)) / (2 * Math.PI)) / 2) * n;
  return { x, y };
}

function tileUrl(z: number, x: number, y: number): string {
  const host = CARTO_HOSTS[(x + y) % CARTO_HOSTS.length];
  return `https://${host}.basemaps.cartocdn.com/dark_nolabels/${z}/${x}/${y}@2x.png`;
}

async function fetchTile(z: number, x: number, y: number): Promise<Buffer> {
  const url = tileUrl(z, x, y);
  const res = await fetch(url, {
    headers: {
      "User-Agent": "FieldSurvey/1.0 (+thumb-generator)",
      Accept: "image/png,image/*;q=0.8",
    },
    // Carto tiles change rarely; long cache is fine.
    cache: "force-cache",
  });
  if (!res.ok) throw new Error(`tile ${z}/${x}/${y} → HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Build a 2×2 raster mosaic of tiles surrounding (centerLat, centerLon)
 * at zoom `z`, then crop to width × height centred on the point.
 *
 * The @2x Carto tile is 512×512; the 2×2 mosaic is therefore 1024×1024.
 * Cropping to the requested viewport gives a centred image, even when the
 * center sits near a tile edge.
 */
export async function generateProjectThumb(opts: ThumbOptions): Promise<ThumbResult> {
  const zoom = opts.zoom ?? 11;
  const width = opts.width ?? 480;
  const height = opts.height ?? 280;

  // Real tile size for @2x Carto.
  const tilePx = TILE_SIZE * 2;

  const { x: fx, y: fy } = lonLatToTile(opts.centerLon, opts.centerLat, zoom);
  const x0 = Math.floor(fx) - 1; // top-left of the 2x2 around the center
  const y0 = Math.floor(fy) - 1;

  // Wrap x at the antimeridian. Y clamps to valid range.
  const nTiles = 2 ** zoom;
  const tiles: Array<{ dx: number; dy: number; buf: Buffer }> = [];
  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      const tileX = ((x0 + tx) % nTiles + nTiles) % nTiles;
      const tileY = Math.max(0, Math.min(nTiles - 1, y0 + ty));
      const buf = await fetchTile(zoom, tileX, tileY);
      tiles.push({ dx: tx * tilePx, dy: ty * tilePx, buf });
    }
  }

  // 2×2 mosaic (1024×1024 for @2x).
  const mosaicSize = tilePx * 2;
  const mosaic = await sharp({
    create: {
      width: mosaicSize,
      height: mosaicSize,
      channels: 3,
      background: { r: 12, g: 16, b: 24 },
    },
  })
    .composite(
      tiles.map((t) => ({
        input: t.buf,
        top: t.dy,
        left: t.dx,
      })),
    )
    .png()
    .toBuffer();

  // The center's pixel within the mosaic. (x0+1, y0+1) is the top-left of
  // the bottom-right tile, so the center's offset inside the mosaic is
  //   (fx - x0) * tilePx, (fy - y0) * tilePx
  const cx = Math.round((fx - x0) * tilePx);
  const cy = Math.round((fy - y0) * tilePx);

  // Crop a width×height window centred on the point, clamped to mosaic bounds.
  const left = Math.max(0, Math.min(mosaicSize - width, cx - Math.floor(width / 2)));
  const top = Math.max(0, Math.min(mosaicSize - height, cy - Math.floor(height / 2)));

  const png = await sharp(mosaic).extract({ left, top, width, height }).png().toBuffer();

  return {
    png,
    width,
    height,
    centerLat: opts.centerLat,
    centerLon: opts.centerLon,
    zoom,
  };
}
