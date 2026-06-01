/**
 * Server-side /home thumbnail generator.
 *
 * Stitches a 2×2 mosaic of ESRI World Imagery satellite tiles around a
 * project's center point, composites ESRI's reference labels overlay on
 * top so the city/town name is always visible, then drops in a soft
 * vignette + bottom fade. Result is uploaded to the `project-thumbs`
 * Supabase Storage bucket by the caller; this module only produces the
 * bytes.
 *
 * Why satellite + labels:
 *   - Labels are the only thing that lets you distinguish "Keystone
 *     Heights" from "Gainesville" at a glance — bare satellite at this
 *     scale shows generic suburbia in both.
 *   - ESRI's Reference/World_Boundaries_and_Places layer is a
 *     transparent raster designed exactly for this hybrid use, with
 *     halo'd text that stays legible on any base.
 *   - Both layers are keyless and licensed for low-volume use.
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

function labelsUrl(z: number, x: number, y: number): string {
  // Transparent PNG with city/town/road labels, halo'd for legibility.
  return `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/${z}/${y}/${x}`;
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

/**
 * SVG overlay: subtle radial vignette + bottom-edge fade so the card
 * never feels flat and overlaid glyphs stay readable.
 */
function overlaySvg(width: number, height: number): Buffer {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <radialGradient id="v" cx="50%" cy="50%" r="75%">
        <stop offset="55%" stop-color="black" stop-opacity="0"/>
        <stop offset="100%" stop-color="black" stop-opacity="0.40"/>
      </radialGradient>
      <linearGradient id="b" x1="0" y1="0" x2="0" y2="1">
        <stop offset="65%" stop-color="black" stop-opacity="0"/>
        <stop offset="100%" stop-color="black" stop-opacity="0.50"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#v)"/>
    <rect width="100%" height="100%" fill="url(#b)"/>
  </svg>`;
  return Buffer.from(svg);
}

/**
 * Build a 2×2 mosaic of satellite tiles with a labels overlay around
 * (centerLat, centerLon) at zoom `z`, crop to width × height centred on
 * the point, then composite the vignette + bottom fade.
 *
 * Tile fetches (8 total: 4 imagery + 4 labels) run in parallel.
 */
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

  const fetched = await Promise.all(
    coords.map(async (c) => {
      const [imagery, labels] = await Promise.all([
        fetchTile(imageryUrl(zoom, c.tx, c.ty)),
        // Labels are best-effort — never block the thumb if ESRI's reference
        // layer hiccups.
        fetchTile(labelsUrl(zoom, c.tx, c.ty)).catch(() => null),
      ]);
      return { dx: c.dx, dy: c.dy, imagery, labels };
    }),
  );

  // 2×2 mosaic (512×512 for standard 256px tiles). Composite imagery first,
  // then labels on top so place names stay readable.
  const mosaicSize = TILE_SIZE * 2;
  const composites: Array<{ input: Buffer; top: number; left: number }> = [];
  for (const t of fetched) composites.push({ input: t.imagery, top: t.dy, left: t.dx });
  for (const t of fetched) {
    if (t.labels) composites.push({ input: t.labels, top: t.dy, left: t.dx });
  }

  const mosaic = await sharp({
    create: {
      width: mosaicSize,
      height: mosaicSize,
      channels: 3,
      background: { r: 12, g: 16, b: 24 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();

  // Center pixel within the mosaic.
  const cx = Math.round((fx - x0) * TILE_SIZE);
  const cy = Math.round((fy - y0) * TILE_SIZE);

  // Crop a width×height window centred on the point, clamped to mosaic bounds.
  const left = Math.max(0, Math.min(mosaicSize - width, cx - Math.floor(width / 2)));
  const top = Math.max(0, Math.min(mosaicSize - height, cy - Math.floor(height / 2)));

  const cropped = await sharp(mosaic).extract({ left, top, width, height }).png().toBuffer();

  // Composite vignette + bottom fade for depth and legibility.
  const png = await sharp(cropped)
    .composite([{ input: overlaySvg(width, height), top: 0, left: 0 }])
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
