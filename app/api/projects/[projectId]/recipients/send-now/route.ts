/**
 * POST /api/projects/:projectId/recipients/send-now
 *
 * Owner/admin only — fires the daily digest to every NON-PAUSED recipient
 * for this project right now (no cron wait). Recipients with zero new
 * points/responses since their last_sent_at are still skipped (locked
 * Q2 decision: "skip empty days").
 *
 * Returns: { sent: number, skipped_empty: number, paused: number, failed: number }
 */

import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { sendDailyDigestEmail, type DigestProjectSummary } from "@/lib/email";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
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

  // Load recipients + project name in parallel.
  type RecipientRow = {
    id: string;
    name: string | null;
    email: string;
    paused: boolean;
    last_sent_at: string | null;
  };
  const [recipientsRes, projectRes] = await Promise.all([
    sbAny
      .from("change_report_recipients")
      .select("id, name, email, paused, last_sent_at")
      .eq("project_id", projectId),
    sbAny.from("projects").select("name").eq("id", projectId).maybeSingle(),
  ]);
  if (recipientsRes.error) {
    return NextResponse.json({ error: recipientsRes.error.message }, { status: 500 });
  }
  const recipients: RecipientRow[] = (recipientsRes.data ?? []) as RecipientRow[];
  const projectName = (projectRes.data as { name?: string } | null)?.name ?? "Project";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const projectUrl = `${appUrl}/p/${projectId}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: countsRow } = await (sb.from("v_match_status_counts") as any)
    .select("m1_count, f1_count, r1_count")
    .eq("project_id", projectId)
    .maybeSingle();
  const counts = (countsRow as { m1_count: number; f1_count: number; r1_count: number } | null) ?? null;

  let sent = 0,
    paused = 0,
    skippedEmpty = 0,
    failed = 0;

  for (const r of recipients) {
    if (r.paused) {
      paused += 1;
      continue;
    }
    const since = r.last_sent_at ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const [ptsRes, respRes] = await Promise.all([
      sb
        .from("points")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .gte("created_at", since),
      sb
        .from("survey_responses")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .gte("imported_at", since),
    ]);
    const newPoints = ptsRes.count ?? 0;
    const newResponses = respRes.count ?? 0;

    if (newPoints === 0 && newResponses === 0) {
      skippedEmpty += 1;
      continue;
    }

    const projects: DigestProjectSummary[] = [
      {
        projectName,
        url: projectUrl,
        newPoints,
        newResponses,
        m1: counts?.m1_count ?? 0,
        f1: counts?.f1_count ?? 0,
        r1: counts?.r1_count ?? 0,
      },
    ];
    const period = new Date().toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
    const out = await sendDailyDigestEmail({ to: r.email, period, projects });
    if (out.ok) {
      sent += 1;
      await sbAny
        .from("change_report_recipients")
        .update({ last_sent_at: new Date().toISOString() })
        .eq("id", r.id);
    } else {
      failed += 1;
    }
  }

  return NextResponse.json({ ok: true, sent, paused, skipped_empty: skippedEmpty, failed });
}
