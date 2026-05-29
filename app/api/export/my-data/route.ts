/**
 * POST /api/export/my-data
 *
 * Emails the signed-in surveyor a CSV of their own points (across all
 * projects they're a member of, or scoped to one project if `projectId`
 * is supplied), with semicolon-joined 7-day signed photo URLs in the
 * `photo_urls` column.
 *
 * Locked Q3 decision:
 *   • Auth-only; surveyor can only export their OWN points.
 *   • Delivery = surveyor's account email only (no custom-address field;
 *     prevents typo-leak).
 *   • Throttle = 1 export per hour per user (best-effort in-process; the
 *     proper DB-side throttle ships when a future migration adds
 *     `profiles.last_export_at` — see TODO below).
 *   • Photos = semicolon-joined signed Supabase Storage URLs valid 7 days.
 *
 * Request body (JSON, all fields optional):
 *   {
 *     "projectId": "uuid"   // scope to one project; omit to export ALL
 *   }
 *
 * Response (200):
 *   { ok: true, message: "Sent to you@example.com", rows: 142, projects: 1 }
 *
 * Response (4xx/5xx):
 *   { ok: false, error: "..." }
 */

import "server-only";
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { signForWeeklyExport } from "@/lib/storage/signed-urls";

// DB-side throttle. profiles.last_export_at is persistent so concurrent
// serverless invocations across cold starts honour the same window.
const THROTTLE_MS = 60 * 60 * 1000; // 1 hour

type ExportRow = {
  id: string;
  project_id: string;
  project_name: string;
  status_label: string | null;
  lat: number;
  lon: number;
  accuracy_m: number | null;
  address: string | null;
  notes: string | null;
  collected_at: string;
  synced_at: string;
  photo_paths: string[];
};

export async function POST(req: Request) {
  const supabase = await createServerSupabase();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }
  const user = userData.user;

  // DB-side throttle — single source of truth across instances.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profileRaw } = await (supabase.from("profiles") as any)
    .select("last_export_at")
    .eq("id", user.id)
    .maybeSingle();
  const lastIso = (profileRaw as { last_export_at: string | null } | null)?.last_export_at ?? null;
  if (lastIso) {
    const elapsed = Date.now() - new Date(lastIso).getTime();
    if (elapsed < THROTTLE_MS) {
      const mins = Math.ceil((THROTTLE_MS - elapsed) / 60_000);
      return NextResponse.json(
        { ok: false, error: `Please wait ${mins} minute${mins === 1 ? "" : "s"} before exporting again.` },
        { status: 429 },
      );
    }
  }

  // Parse body
  let projectId: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.projectId === "string" && body.projectId.length > 0) {
      projectId = body.projectId;
    }
  } catch {
    /* allow empty body */
  }

  // Fetch points (RLS already scopes to projects the user can read; we
  // additionally filter to ones THIS user collected).
  let query = supabase
    .from("points")
    .select(
      `id, project_id, lat, lon, accuracy_m, address, notes, collected_at, updated_at,
       project:projects ( id, name ),
       status:project_statuses ( id, label ),
       photos:point_photos ( storage_path )`,
    )
    .eq("collector_id", user.id)
    .order("collected_at", { ascending: false })
    .limit(10_000);
  if (projectId) query = query.eq("project_id", projectId);

  const { data: rows, error: pErr } = await query;
  if (pErr) {
    return NextResponse.json(
      { ok: false, error: `Database error: ${pErr.message}` },
      { status: 500 },
    );
  }
  if (!rows || rows.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No points found for your account." },
      { status: 404 },
    );
  }

  // Normalize the shape; Supabase typing on joins is awkward.
  type PointJoined = {
    id: string;
    project_id: string;
    lat: number;
    lon: number;
    accuracy_m: number | null;
    address: string | null;
    notes: string | null;
    collected_at: string;
    updated_at: string;
    project: { id: string; name: string } | { id: string; name: string }[] | null;
    status: { id: string; label: string } | { id: string; label: string }[] | null;
    photos: { storage_path: string }[] | null;
  };
  const exportRows: ExportRow[] = (rows as PointJoined[]).map((r) => {
    const proj = Array.isArray(r.project) ? r.project[0] : r.project;
    const stat = Array.isArray(r.status) ? r.status[0] : r.status;
    return {
      id: r.id,
      project_id: r.project_id,
      project_name: proj?.name ?? "(unknown project)",
      status_label: stat?.label ?? null,
      lat: r.lat,
      lon: r.lon,
      accuracy_m: r.accuracy_m,
      address: r.address,
      notes: r.notes,
      collected_at: r.collected_at,
      synced_at: r.updated_at,
      photo_paths: (r.photos ?? []).map((p) => p.storage_path),
    };
  });

  // Sign every photo path in one batch (7-day TTL).
  const allPaths = Array.from(new Set(exportRows.flatMap((r) => r.photo_paths)));
  const signed = await signForWeeklyExport("point-photos", allPaths);
  const pathToUrl = new Map<string, string>();
  allPaths.forEach((p, i) => {
    const s = signed[i];
    if (s?.url) pathToUrl.set(p, s.url);
  });

  // Build CSV
  const csv = buildCsv(exportRows, pathToUrl);

  // Email — recipient = the user's account email (locked Q3).
  const recipient = user.email;
  if (!recipient) {
    return NextResponse.json(
      { ok: false, error: "Your account has no email on file." },
      { status: 400 },
    );
  }

  const projectCount = new Set(exportRows.map((r) => r.project_id)).size;
  const subject = projectId
    ? `Your FieldSurvey export — ${exportRows[0].project_name}`
    : `Your FieldSurvey export — ${exportRows.length.toLocaleString()} points`;

  const text =
    `Your FieldSurvey export is attached.\n\n` +
    `Points: ${exportRows.length.toLocaleString()}\n` +
    `Projects: ${projectCount}\n` +
    `Photo URLs are valid for 7 days.\n\n` +
    `— FieldSurvey`;

  const html =
    `<p>Your FieldSurvey export is attached.</p>` +
    `<ul><li>Points: <b>${exportRows.length.toLocaleString()}</b></li>` +
    `<li>Projects: <b>${projectCount}</b></li>` +
    `<li>Photo URLs are valid for 7 days.</li></ul>` +
    `<p>— FieldSurvey</p>`;

  // sendEmail in lib/email.ts doesn't expose attachments directly; we
  // augment the call by reusing its transporter via a custom send below.
  const attachmentName = projectId
    ? `fieldsurvey-${exportRows[0].project_name.replace(/[^a-z0-9-]+/gi, "-")}-${dateStamp()}.csv`
    : `fieldsurvey-export-${dateStamp()}.csv`;

  const sendResult = await sendCsvEmail({
    to: recipient,
    subject,
    text,
    html,
    csv,
    attachmentName,
  });
  if (!sendResult.ok) {
    return NextResponse.json(
      { ok: false, error: `Email failed: ${sendResult.error}` },
      { status: 500 },
    );
  }

  // Persist the throttle stamp. Failure here is non-fatal (the user got
  // their email); we log and continue.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from("profiles") as any)
    .update({ last_export_at: new Date().toISOString() })
    .eq("id", user.id);

  return NextResponse.json({
    ok: true,
    message: `Sent to ${recipient}.`,
    rows: exportRows.length,
    projects: projectCount,
  });
}

// ── CSV builder — RFC 4180 quoting on every field ───────────────────────────
function buildCsv(rows: ExportRow[], pathToUrl: Map<string, string>): string {
  const header = [
    "id",
    "project",
    "status",
    "lat",
    "lon",
    "accuracy_m",
    "address",
    "notes",
    "collected_at",
    "synced_at",
    "photo_urls",
  ];
  const lines = [header.map(csvEscape).join(",")];
  for (const r of rows) {
    const photoUrls = r.photo_paths
      .map((p) => pathToUrl.get(p) ?? "")
      .filter(Boolean)
      .join(";");
    lines.push(
      [
        r.id,
        r.project_name,
        r.status_label ?? "",
        r.lat,
        r.lon,
        r.accuracy_m ?? "",
        r.address ?? "",
        r.notes ?? "",
        r.collected_at,
        r.synced_at,
        photoUrls,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return lines.join("\r\n");
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function dateStamp(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ── Email sender with CSV attachment (uses the shared Gmail SMTP transport) ─
async function sendCsvEmail(args: {
  to: string;
  subject: string;
  text: string;
  html: string;
  csv: string;
  attachmentName: string;
}): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  // We import nodemailer here to avoid pulling it into the client bundle.
  // The shared transport from lib/email.ts is private; we replicate the
  // env-driven setup so the attachment path is straightforward.
  const nodemailer = await import("nodemailer");
  const user = (process.env.GMAIL_USER ?? "").trim();
  const pass = (process.env.GMAIL_APP_PASSWORD ?? "").trim().replace(/\s+/g, "");
  if (!user || !pass) {
    return { ok: false, error: "Gmail SMTP not configured" };
  }
  const fromName = (process.env.EMAIL_FROM_NAME ?? "FieldSurvey").trim();
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: { user, pass },
  });
  try {
    const info = await transporter.sendMail({
      from: `"${fromName.replace(/"/g, '\\"')}" <${user}>`,
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
      attachments: [
        {
          filename: args.attachmentName,
          content: args.csv,
          contentType: "text/csv; charset=utf-8",
        },
      ],
    });
    // Fallback message id — newer Nodemailer typings make messageId
    // possibly-undefined on the return, but the SMTP layer always sets it.
    return { ok: true, messageId: info.messageId ?? "(unknown)" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
