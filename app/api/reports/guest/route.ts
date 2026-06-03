import { NextResponse } from "next/server";
import { readGuestSession } from "@/lib/auth/guest-session";
import { createAdminSupabase } from "@/lib/supabase/admin";

/**
 * POST /api/reports/guest
 *
 * multipart/form-data fields:
 *   - title   (string, required, ≤ 80 chars)
 *   - body    (string, required, ≤ 4000 chars)
 *   - lat     (string optional, parsed to float)
 *   - lon     (string optional, parsed to float)
 *   - guest_name (string optional, ≤ 80)
 *   - photo   (File optional, image/* only, ≤ 5 MB)
 *
 * Auth: requires a valid fs_guest cookie. The cookie's projectId is the
 * authoritative project — the client cannot smuggle a different project_id
 * in the body. This blocks "guest in project A sends report to project B"
 * across the same browser.
 *
 * Service role insert (RLS denies anonymous writes). Photo uploads use the
 * guest-reports bucket with path = <project_id>/<report_id>/<uuid>.<ext>.
 */
/** Per-session rate limit — 20 reports per hour, keyed on guest.sessionId. */
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = 20;

export async function POST(req: Request) {
  const guest = await readGuestSession();
  if (!guest) {
    return NextResponse.json(
      { ok: false, error: "Guest session required" },
      { status: 401 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Multipart body required" },
      { status: 400 },
    );
  }

  const title = String(form.get("title") ?? "").trim();
  const body = String(form.get("body") ?? "").trim();
  const guestName = String(form.get("guest_name") ?? "").trim() || null;
  const latRaw = form.get("lat");
  const lonRaw = form.get("lon");
  const photo = form.get("photo");

  if (!title || title.length > 80) {
    return NextResponse.json(
      { ok: false, error: "Title required (≤ 80 chars)" },
      { status: 400 },
    );
  }
  if (!body || body.length > 4000) {
    return NextResponse.json(
      { ok: false, error: "Body required (≤ 4000 chars)" },
      { status: 400 },
    );
  }

  let lat: number | null = null;
  let lon: number | null = null;
  if (typeof latRaw === "string" && latRaw.length > 0) {
    const v = Number(latRaw);
    if (Number.isFinite(v) && v >= -90 && v <= 90) lat = v;
  }
  if (typeof lonRaw === "string" && lonRaw.length > 0) {
    const v = Number(lonRaw);
    if (Number.isFinite(v) && v >= -180 && v <= 180) lon = v;
  }

  // lib/db.types.ts is stale until next regen — cast away the table
  // typing so guest_reports queries compile. Safe because the columns
  // are validated above and the storage path is constructed server-side.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createAdminSupabase() as any;

  // Rate limit: count this session's reports inside the rolling window
  // and reject if at-or-above cap. Uses the existing index on
  // (project_id, created_at). Race-safe enough for nuisance prevention;
  // a determined attacker could squeeze through with a burst, but the
  // budget (20/h) is too small to cause damage.
  const windowStart = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const { count: recentCount } = await sb
    .from("guest_reports")
    .select("id", { head: true, count: "exact" })
    .eq("project_id", guest.projectId)
    .eq("guest_session_id", guest.sessionId)
    .gte("created_at", windowStart);
  if ((recentCount ?? 0) >= RATE_MAX) {
    return NextResponse.json(
      { ok: false, error: "Rate limit reached. Please try again later." },
      { status: 429 },
    );
  }

  const { data: inserted, error: insertErr } = await sb.from("guest_reports")
    .insert({
      project_id: guest.projectId,
      guest_session_id: guest.sessionId,
      guest_name: guestName,
      title,
      body,
      lat,
      lon,
    })
    .select("id")
    .single() as { data: { id: string } | null; error: { message: string } | null };

  if (insertErr || !inserted) {
    return NextResponse.json(
      { ok: false, error: insertErr?.message ?? "Insert failed" },
      { status: 500 },
    );
  }

  let photoPath: string | null = null;
  if (photo instanceof File && photo.size > 0) {
    if (photo.size > 5 * 1024 * 1024) {
      return NextResponse.json(
        { ok: false, error: "Photo too large (max 5 MB)" },
        { status: 400 },
      );
    }
    if (!photo.type.startsWith("image/")) {
      return NextResponse.json(
        { ok: false, error: "Only images may be attached" },
        { status: 400 },
      );
    }
    const ext = photo.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "jpg";
    photoPath = `${guest.projectId}/${inserted.id}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await sb.storage
      .from("guest-reports")
      .upload(photoPath, photo, { contentType: photo.type, upsert: false });
    if (upErr) {
      // Log internal error, return generic message — Supabase storage
      // messages can leak bucket names / internal paths.
      console.error("[guest-report] photo upload failed", {
        reportId: inserted.id,
        err: upErr.message,
      });
      return NextResponse.json(
        {
          ok: true,
          id: inserted.id,
          warning: "Report saved but the photo could not be attached.",
        },
        { status: 200 },
      );
    }
    const { error: updErr } = await sb
      .from("guest_reports")
      .update({ photo_path: photoPath })
      .eq("id", inserted.id);
    if (updErr) {
      // Storage object is now orphaned; admin can still read the row.
      // Log so we can sweep these later. Don't fail the request — the
      // report itself was saved.
      console.error("[guest-report] update photo_path failed (orphan)", {
        reportId: inserted.id,
        photoPath,
        err: updErr.message,
      });
    }
  }

  return NextResponse.json({ ok: true, id: inserted.id, photoPath });
}
