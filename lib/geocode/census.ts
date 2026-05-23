/**
 * U.S. Census Bureau Geocoder — free, no API key, accurate for U.S. addresses.
 * Same provider Keystone used in api/_processing.py.
 *
 * Endpoint: https://geocoding.geo.census.gov/geocoder/locations/onelineaddress
 * Docs: https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html
 *
 * CRITICAL — never trust a survey response's own lat/lon, always re-geocode
 * the address column. See project_fieldsurvey_matching_algorithm.md.
 */

export type GeocodeResult = {
  lat: number;
  lon: number;
  matchedAddress: string;
  tigerLineId?: string;
  source: "census";
};

const CENSUS_BASE = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";

export async function geocodeCensus(address: string): Promise<GeocodeResult | null> {
  if (!address?.trim()) return null;
  const url = new URL(CENSUS_BASE);
  url.searchParams.set("address", address);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");

  const res = await fetch(url, {
    headers: { "User-Agent": "FieldSurvey/1.0" },
    next: { revalidate: 86400 },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    result?: { addressMatches?: Array<{
      matchedAddress: string;
      coordinates: { x: number; y: number };
      tigerLine?: { tigerLineId?: string };
    }> };
  };
  const m = data.result?.addressMatches?.[0];
  if (!m) return null;
  return {
    lat: m.coordinates.y,
    lon: m.coordinates.x,
    matchedAddress: m.matchedAddress,
    tigerLineId: m.tigerLine?.tigerLineId,
    source: "census",
  };
}

/** Haversine distance in meters. Used by the 30m proximity matcher. */
export function haversineMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
