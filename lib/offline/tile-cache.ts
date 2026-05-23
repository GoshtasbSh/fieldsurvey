/**
 * Tile pre-cache utilities — pulls every OSM tile in a bounding box at
 * zooms zMin..zMax into the service worker's tile cache, so a surveyor
 * can work entirely offline within that area.
 *
 * Tile math: standard slippy-tile XYZ scheme.
 *   https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames
 */

const TILE_HOST = "https://tile.openstreetmap.org";

export type TileProgress = { done: number; total: number };

export function lonLatToTile(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return { x, y };
}

/** Approximate metres → degrees lat at the given centre latitude. */
export function metersBoundingBox(centerLat: number, centerLon: number, radiusMeters: number) {
  const dLat = radiusMeters / 111_320;
  const dLon = radiusMeters / (111_320 * Math.cos((centerLat * Math.PI) / 180));
  return { north: centerLat + dLat, south: centerLat - dLat, east: centerLon + dLon, west: centerLon - dLon };
}

/** Returns the URLs we'd need to fetch to cover the box at the given zoom range. */
export function tilesForBox(box: { north: number; south: number; east: number; west: number }, zMin: number, zMax: number): string[] {
  const out: string[] = [];
  for (let z = zMin; z <= zMax; z++) {
    const tl = lonLatToTile(box.west, box.north, z);
    const br = lonLatToTile(box.east, box.south, z);
    for (let x = tl.x; x <= br.x; x++) {
      for (let y = tl.y; y <= br.y; y++) {
        out.push(`${TILE_HOST}/${z}/${x}/${y}.png`);
      }
    }
  }
  return out;
}

/**
 * Fetch each tile so it lands in the SW's stale-while-revalidate cache.
 * Concurrency-limited to be polite to OSM (their TOS asks for ≤2 req/s
 * for bulk; we use 4 concurrent which is borderline — for ANY production
 * volume, switch to MapTiler / Stadia / your own raster source).
 */
export async function preCacheTiles(urls: string[], onProgress?: (p: TileProgress) => void, concurrency = 4): Promise<void> {
  let done = 0;
  const total = urls.length;
  const queue = urls.slice();
  async function worker() {
    while (queue.length) {
      const u = queue.shift();
      if (!u) return;
      try { await fetch(u, { mode: "cors", cache: "default" }); } catch { /* ignore */ }
      done += 1;
      onProgress?.({ done, total });
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
}
