/**
 * Reverse-geocode a coordinate to a "City, ST" label for /home cards.
 *
 * Uses OpenStreetMap Nominatim (keyless, fair-use ≤1 req/sec, requires a
 * User-Agent). Results are cached for 30 days via Next.js's fetch data
 * cache — a project's coordinates rarely change, so the first /home
 * render warms it and subsequent renders are instant.
 *
 * Failure is silent — returns null and the card falls back to a
 * coordinate readout. The card must never block on geocoding.
 */

import "server-only";

type NominatimResp = {
  address?: {
    city?: string;
    town?: string;
    village?: string;
    hamlet?: string;
    municipality?: string;
    county?: string;
    state?: string;
    state_code?: string;
    country_code?: string;
    "ISO3166-2-lvl4"?: string;
  };
};

// US state abbreviations — derived from ISO3166-2-lvl4 ("US-FL" → "FL").
function stateAbbr(addr: NonNullable<NominatimResp["address"]>): string | null {
  const iso = addr["ISO3166-2-lvl4"];
  if (iso && /^US-[A-Z]{2}$/.test(iso)) return iso.slice(3);
  return addr.state_code ? addr.state_code.toUpperCase() : null;
}

function pickPlace(addr: NonNullable<NominatimResp["address"]>): string | null {
  return (
    addr.city ??
    addr.town ??
    addr.village ??
    addr.hamlet ??
    addr.municipality ??
    addr.county ??
    null
  );
}

export async function reverseGeocode(
  lat: number,
  lon: number,
): Promise<{ place: string; region: string | null } | null> {
  // Round to ~100m so nearby projects share a cache key.
  const qLat = lat.toFixed(3);
  const qLon = lon.toFixed(3);
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${qLat}&lon=${qLon}&zoom=10&addressdetails=1`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "FieldSurvey/1.0 (https://fieldsurvey-alpha.vercel.app; contact: goshtasbshahriari@gmail.com)",
        Accept: "application/json",
      },
      // Next.js data cache — same coords → cached for 30 days.
      next: { revalidate: 60 * 60 * 24 * 30, tags: [`geocode:${qLat},${qLon}`] },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as NominatimResp;
    const addr = json.address;
    if (!addr) return null;
    const place = pickPlace(addr);
    if (!place) return null;
    const region =
      addr.country_code === "us" ? stateAbbr(addr) : addr.state ?? null;
    return { place, region };
  } catch {
    return null;
  }
}

/** Format as "City, ST" or just "City" when no region. */
export function formatLabel(
  geo: { place: string; region: string | null } | null,
): string | null {
  if (!geo) return null;
  return geo.region ? `${geo.place}, ${geo.region}` : geo.place;
}
