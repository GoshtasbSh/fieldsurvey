/**
 * POST /api/projects/[projectId]/universe/upload
 *
 * Bulk-ingest a canvass universe from CSV. Owner/admin only.
 *
 * Content-type: multipart/form-data
 *   - file: the CSV (required)
 *
 * Required column: `address`
 * Optional columns: `lat`, `lon`, `external_id`
 *
 * Returns { inserted, skipped, errors }.
 */

import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { snapAddressToParcel } from "@/lib/queries/parcels";

const BATCH = 200;
const MAX_ROWS = 50_000;

type UniverseInsert = {
  project_id: string;
  address: string;
  lat: number | null;
  lon: number | null;
  external_id: string | null;
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const { data: role } = await sbAny.rpc("project_role", { p_project: projectId });
  if (role !== "owner" && role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }
  const csv = await file.text();

  const parsed = parseCsv(csv);
  if (parsed.error) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  if (parsed.rows.length === 0) {
    return NextResponse.json({ error: "no data rows" }, { status: 400 });
  }
  if (parsed.rows.length > MAX_ROWS) {
    return NextResponse.json({ error: `too many rows (max ${MAX_ROWS})` }, { status: 413 });
  }

  const inserts: UniverseInsert[] = [];
  let skipped = 0;
  let snapped = 0;
  for (const r of parsed.rows) {
    const address = (r.address ?? "").trim();
    if (!address) {
      skipped++;
      continue;
    }
    const rawLat = numOrNull(r.lat);
    const rawLon = numOrNull(r.lon);
    let lat = rawLat !== null && rawLat >= -90 && rawLat <= 90 ? rawLat : null;
    let lon = rawLon !== null && rawLon >= -180 && rawLon <= 180 ? rawLon : null;

    // M6 — snap to parcel centroid when row has no coords. Sequential rather
    // than parallel because most universes are < 5k rows and we'd rather
    // keep Postgres happy than save a few seconds.
    if (lat === null || lon === null) {
      const hit = await snapAddressToParcel({ projectId, address, client: "user" });
      if (hit) {
        lat = hit.lat;
        lon = hit.lon;
        snapped++;
      }
    }

    inserts.push({
      project_id: projectId,
      address,
      lat,
      lon,
      external_id: (r.external_id ?? "").trim() || null,
    });
  }

  let inserted = 0;
  const errors: string[] = [];
  for (let i = 0; i < inserts.length; i += BATCH) {
    const slice = inserts.slice(i, i + BATCH);
    const { error, count } = await sbAny
      .from("survey_universe")
      .insert(slice, { count: "exact" });
    if (error) {
      errors.push(error.message);
    } else {
      inserted += count ?? slice.length;
    }
  }

  return NextResponse.json({ inserted, skipped, snapped, errors });
}

// ── CSV parser (RFC 4180-ish, header-row required) ─────────────────────────

function parseCsv(input: string): { rows: Record<string, string>[]; error?: string } {
  const text = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = splitCsvRows(text).filter((l) => l.length > 0);
  if (lines.length === 0) return { rows: [], error: "empty file" };

  const header = parseCsvRow(lines[0]).map((h) => h.trim().toLowerCase());
  if (!header.includes("address")) {
    return { rows: [], error: "missing required column: address" };
  }
  const rows: Record<string, string>[] = [];
  for (let li = 1; li < lines.length; li++) {
    const cols = parseCsvRow(lines[li]);
    if (cols.length === 1 && cols[0] === "") continue;
    const row: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) {
      row[header[i]] = cols[i] ?? "";
    }
    rows.push(row);
  }
  return { rows };
}

function splitCsvRows(text: string): string[] {
  const rows: string[] = [];
  let buf = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      buf += c;
      // Toggle, but handle escaped "" inside quoted fields by leaving the
      // pair intact — parseCsvRow handles the escape unwrap.
      const next = text[i + 1];
      if (inQuotes && next === '"') {
        buf += next;
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === "\n" && !inQuotes) {
      rows.push(buf);
      buf = "";
    } else {
      buf += c;
    }
  }
  if (buf.length > 0) rows.push(buf);
  return rows;
}

function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        buf += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === "," && !inQuotes) {
      out.push(buf);
      buf = "";
    } else {
      buf += c;
    }
  }
  out.push(buf);
  return out;
}

function numOrNull(s: string | undefined): number | null {
  if (s === undefined) return null;
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
