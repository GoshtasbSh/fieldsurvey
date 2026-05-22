import { NextResponse, type NextRequest } from "next/server";
import { geocodeAddress } from "@/lib/geocode";

export async function GET(req: NextRequest) {
  const q = new URL(req.url).searchParams.get("q") || "";
  if (!q.trim()) return NextResponse.json({ error: "missing q" }, { status: 400 });
  const r = await geocodeAddress(q);
  return NextResponse.json(r ?? { error: "no match" }, { status: r ? 200 : 404 });
}
