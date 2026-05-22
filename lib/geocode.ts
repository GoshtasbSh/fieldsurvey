type Result = { lat: number; lon: number; displayName: string };

export async function geocodeAddress(query: string): Promise<Result | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  const res = await fetch(url, { headers: { "User-Agent": "FieldSurvey/1.0" } });
  if (!res.ok) return null;
  const rows = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
  if (rows.length === 0) return null;
  return { lat: parseFloat(rows[0].lat), lon: parseFloat(rows[0].lon), displayName: rows[0].display_name };
}
