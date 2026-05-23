import { NextResponse, type NextRequest } from "next/server";
import { geocodeAddress } from "@/lib/geocode";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const reverse = url.searchParams.get("reverse");
  if (reverse === "1") {
    const lat = parseFloat(url.searchParams.get("lat") || "");
    const lon = parseFloat(url.searchParams.get("lon") || "");
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return NextResponse.json({ error: "missing lat/lon" }, { status: 400 });
    }
    const nom = new URL("https://nominatim.openstreetmap.org/reverse");
    nom.searchParams.set("lat", String(lat));
    nom.searchParams.set("lon", String(lon));
    nom.searchParams.set("format", "json");
    const r = await fetch(nom, { headers: { "User-Agent": "FieldSurvey/1.0" }, next: { revalidate: 3600 } });
    if (!r.ok) return NextResponse.json({ error: "reverse failed" }, { status: 502 });
    const j = (await r.json()) as { display_name?: string };
    return NextResponse.json({ displayName: j.display_name ?? null });
  }

  const q = url.searchParams.get("q") || "";
  if (!q.trim()) return NextResponse.json({ error: "missing q" }, { status: 400 });
  const r = await geocodeAddress(q);
  return NextResponse.json(r ?? { error: "no match" }, { status: r ? 200 : 404 });
}
