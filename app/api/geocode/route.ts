import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { geocodeAddress } from "@/lib/geocode";
import { createServerSupabase } from "@/lib/supabase/server";
import { readGuestSession } from "@/lib/auth/guest-session";

/**
 * Auth gate: signed-in user OR active guest session.
 * Without this gate, anyone on the internet could use this route as a free
 * Nominatim proxy (ToS violation risk + IP-block exposure).
 */
async function isAllowedCaller(): Promise<boolean> {
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (user) return true;
  const guest = await readGuestSession();
  return !!guest;
}

export async function GET(req: NextRequest) {
  if (!(await isAllowedCaller())) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const url = new URL(req.url);
  const reverse = url.searchParams.get("reverse");
  if (reverse === "1") {
    const lat = parseFloat(url.searchParams.get("lat") || "");
    const lon = parseFloat(url.searchParams.get("lon") || "");
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return NextResponse.json({ error: "missing or invalid lat/lon" }, { status: 400 });
    }
    const nom = new URL("https://nominatim.openstreetmap.org/reverse");
    nom.searchParams.set("lat", String(lat));
    nom.searchParams.set("lon", String(lon));
    nom.searchParams.set("format", "json");
    const r = await fetch(nom, {
      headers: { "User-Agent": "FieldSurvey/1.0" },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return NextResponse.json({ error: "reverse failed" }, { status: 502 });
    const j = (await r.json()) as { display_name?: string };
    return NextResponse.json({ displayName: j.display_name ?? null });
  }

  const q = url.searchParams.get("q") || "";
  if (!q.trim()) return NextResponse.json({ error: "missing q" }, { status: 400 });
  if (q.length > 256) return NextResponse.json({ error: "q too long" }, { status: 400 });
  const r = await geocodeAddress(q);
  return NextResponse.json(r ?? { error: "no match" }, { status: r ? 200 : 404 });
}
