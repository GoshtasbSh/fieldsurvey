/**
 * Server-side /home thumbnail generator.
 *
 * Produces a clean satellite PNG — no labels, no vignette, no text. All
 * overlays (city name, gradient, project pin, coordinate readout) are
 * composed in CSS by the card so we get crisp text at any DPI and can
 * iterate the design without regenerating PNGs.
 *
 * Pipeline:
 *   1. Fetch a 2×2 mosaic of ESRI World Imagery tiles around the centre.
 *   2. Mosaic, crop to the requested viewport, apply a gentle tonal lift
 *      (slight saturation + contrast) so the imagery feels curated
 *      rather than raw.
 *   3. Emit as PNG. Caller uploads to `project-thumbs`.
 *
 * Why ESRI World Imagery:
 *   - Keyless, photorealistic, globally consistent, generously licensed
 *     for low volume.
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

/** XY tile coords (fractional). */
function lonLatToTile(lon: number, lat: number, z: number): { x: number; y: number } {
  const sin = Math.sin((lat * Math.PI) / 180);
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.log((1 + sin) / (1 - sin)) / (2 * Math.PI)) / 2) * n;
  return { x, y };
}

function imageryUrl(z: number, x: number, y: number): string {
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
}

async function fetchTile(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "FieldSurvey/1.0 (+thumb-generator)",
      Accept: "image/png,image/jpeg,image/*;q=0.8",
    },
    cache: "force-cache",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`tile ${url} → HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function generateProjectThumb(opts: ThumbOptions): Promise<ThumbResult> {
  const zoom = opts.zoom ?? 11;
  const width = opts.width ?? 480;
  const height = opts.height ?? 280;

  const { x: fx, y: fy } = lonLatToTile(opts.centerLon, opts.centerLat, zoom);
  const x0 = Math.floor(fx) - 1; // top-left of the 2x2 around the center
  const y0 = Math.floor(fy) - 1;

  const nTiles = 2 ** zoom;
  const coords: Array<{ dx: number; dy: number; tx: number; ty: number }> = [];
  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      const tileX = ((x0 + tx) % nTiles + nTiles) % nTiles;
      const tileY = Math.max(0, Math.min(nTiles - 1, y0 + ty));
      coords.push({ dx: tx * TILE_SIZE, dy: ty * TILE_SIZE, tx: tileX, ty: tileY });
    }
  }

  const tiles = await Promise.all(
    coords.map(async (c) => ({
      dx: c.dx,
      dy: c.dy,
      buf: await fetchTile(imageryUrl(zoom, c.tx, c.ty)),
    })),
  );

  const mosaicSize = TILE_SIZE * 2;
  const mosaic = await sharp({
    create: {
      width: mosaicSize,
      height: mosaicSize,
      channels: 3,
      background: { r: 12, g: 16, b: 24 },
    },
  })
    .composite(tiles.map((t) => ({ input: t.buf, top: t.dy, left: t.dx })))
    .png()
    .toBuffer();

  const cx = Math.round((fx - x0) * TILE_SIZE);
  const cy = Math.round((fy - y0) * TILE_SIZE);
  const left = Math.max(0, Math.min(mosaicSize - width, cx - Math.floor(width / 2)));
  const top = Math.max(0, Math.min(mosaicSize - height, cy - Math.floor(height / 2)));

  // Gentle tonal lift — keeps the imagery photoreal but feels intentional.
  const png = await sharp(mosaic)
    .extract({ left, top, width, height })
    .modulate({ saturation: 1.08, brightness: 1.02 })
    .linear(1.05, -6) // small contrast bump, slight black-point pull
    .png({ compressionLevel: 9 })
    .toBuffer();

  return {
    png,
    width,
    height,
    centerLat: opts.centerLat,
    centerLon: opts.centerLon,
    zoom,
  };
}
