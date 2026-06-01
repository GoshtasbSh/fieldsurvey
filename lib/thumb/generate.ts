/**
 * Server-side /home thumbnail generator.
 *
 * Stitches a 2×2 mosaic of ESRI World Imagery satellite tiles around a
 * project's center point, then composites a soft vignette and a bottom
 * gradient over the crop so the card text floats nicely above it. The
 * result is uploaded to the `project-thumbs` Supabase Storage bucket by
 * the caller; this module only produces the bytes.
 *
 * Why satellite instead of dark raster:
 *   - Photorealistic aerial views give every project card immediate
 *     visual identity — you can see the actual terrain, water, parcels,
 *     forest, urban grain. The previous dark base looked near-black and
 *     made every card feel identical.
 *   - ESRI World Imagery is keyless, globally consistent, and licensed
 *     for low-volume use (we stamp attribution in the card footer).
 *   - The vignette + bottom fade pulls the eye to the centre while
 *     guaranteeing legible contrast for any glyphs we layer on top.
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

function tileUrl(z: number, x: number, y: number): string {
  // ESRI World Imagery — no API key, 256×256, global coverage.
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
}

async function fetchTile(z: number, x: number, y: number): Promise<Buffer> {
  const url = tileUrl(z, x, y);
  const res = await fetch(url, {
    headers: {
      "User-Agent": "FieldSurvey/1.0 (+thumb-generator)",
      Accept: "image/jpeg,image/png,image/*;q=0.8",
    },
    cache: "force-cache",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`tile ${z}/${x}/${y} → HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * SVG overlay: subtle radial vignette + bottom-edge fade-to-black so the
 * card never feels flat and any future glyph/badge stays readable.
 */
function overlaySvg(width: number, height: number): Buffer {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <radialGradient id="v" cx="50%" cy="50%" r="75%">
        <stop offset="55%" stop-color="black" stop-opacity="0"/>
        <stop offset="100%" stop-color="black" stop-opacity="0.45"/>
      </radialGradient>
      <linearGradient id="b" x1="0" y1="0" x2="0" y2="1">
        <stop offset="65%" stop-color="black" stop-opacity="0"/>
        <stop offset="100%" stop-color="black" stop-opacity="0.55"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#v)"/>
    <rect width="100%" height="100%" fill="url(#b)"/>
  </svg>`;
  return Buffer.from(svg);
}

/**
 * Build a 2×2 raster mosaic of satellite tiles surrounding
 * (centerLat, centerLon) at zoom `z`, crop to width × height centred on
 * the point, then composite a vignette + bottom fade.
 *
 * Tiles fetch in parallel — at 4 requests this is bounded and keeps
 * worst-case latency near a single tile RTT.
 */
export async function generateProjectThumb(opts: ThumbOptions): Promise<ThumbResult> {
  const zoom = opts.zoom ?? 12;
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
    coords.map(async (c) => ({ dx: c.dx, dy: c.dy, buf: await fetchTile(zoom, c.tx, c.ty) })),
  );

  // 2×2 mosaic (512×512 for standard 256px tiles).
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
