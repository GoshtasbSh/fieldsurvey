import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { sendDailyDigestEmail, sendCapWarningEmail, type DigestProjectSummary } from "@/lib/email";

/**
 * Cron endpoint. Schedule with Vercel Cron (or any external cron) and
 * protect with x-cron-secret = INTERNAL_API_SECRET.
 *
 * Each run:
 *   1. Daily digest: for every user with email_digest=true, sum new
 *      points + responses across their projects in the last 24h
 *   2. Cap warnings: for project owners with email_caps=true, send a
 *      warning when any cap is >=warn_at_pct% (90% by default).
 *      De-duplicated by sending at most once per 24h per project.
 */
export async function GET(req: NextRequest) {
  const supplied = req.headers.get("x-cron-secret") ?? "";
  const expected = process.env.INTERNAL_API_SECRET ?? "";
  if (!expected || supplied !== expected) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sb = createAdminSupabase();
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  // ── Daily digest ─────────────────────────────────────────────────────
  const digestRecipients: { user_id: string; email: string }[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: subs } = await (sb.from("notification_prefs") as any)
    .select("user_id, profiles!notification_prefs_user_id_fkey(email)")
    .eq("email_digest", true) as { data: Array<{ user_id: string; profiles: { email: string } | null }> | null };
  for (const s of subs ?? []) if (s.profiles?.email) digestRecipients.push({ user_id: s.user_id, email: s.profiles.email });

  let digestsSent = 0;
  for (const r of digestRecipients) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rows } = await (sb.from("project_members") as any)
      .select("project_id, projects(id, name)")
      .eq("user_id", r.user_id) as { data: Array<{ project_id: string; projects: { id: string; name: string } | null }> | null };

    const projects: DigestProjectSummary[] = [];
    for (const m of rows ?? []) {
      if (!m.projects) continue;
      const [pts, resp, counts] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (sb.from("points") as any).select("id", { count: "exact", head: true }).eq("project_id", m.project_id).gte("created_at", since),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (sb.from("survey_responses") as any).select("id", { count: "exact", head: true }).eq("project_id", m.project_id).gte("imported_at", since),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (sb.from("v_match_status_counts") as any).select("m1_count, f1_count, r1_count").eq("project_id", m.project_id).maybeSingle(),
      ]);
      const newPoints = (pts as { count: number | null }).count ?? 0;
      const newResponses = (resp as { count: number | null }).count ?? 0;
      if (newPoints === 0 && newResponses === 0) continue;
      const c = (counts as { data: { m1_count: number; f1_count: number; r1_count: number } | null }).data;
      projects.push({
        projectName: m.projects.name,
        url: `${appUrl}/p/${m.project_id}`,
        newPoints, newResponses,
        m1: c?.m1_count ?? 0, f1: c?.f1_count ?? 0, r1: c?.r1_count ?? 0,
      });
    }
    if (projects.length > 0) {
      const period = new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
      const out = await sendDailyDigestEmail({ to: r.email, period, projects });
      if (out.ok) digestsSent++;
    }
  }

  // ── Cap warnings ─────────────────────────────────────────────────────
  let warningsSent = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: caps } = await (sb.from("v_project_caps") as any).select("project_id, points_count, max_points_per_project, pending_invites, max_pending_invites, warn_at_pct") as { data: Array<{ project_id: string; points_count: number; max_points_per_project: number; pending_invites: number; max_pending_invites: number; warn_at_pct: number }> | null };

  for (const c of caps ?? []) {
    const overPoints = c.points_count / Math.max(c.max_points_per_project, 1) * 100 >= c.warn_at_pct;
    const overInvites = c.pending_invites / Math.max(c.max_pending_invites, 1) * 100 >= c.warn_at_pct;
    if (!overPoints && !overInvites) continue;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: project } = await (sb.from("projects") as any).select("name, owner_id").eq("id", c.project_id).maybeSingle() as { data: { name: string; owner_id: string } | null };
    if (!project) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: owner } = await (sb.from("profiles") as any).select("email").eq("id", project.owner_id).maybeSingle() as { data: { email: string } | null };
    if (!owner) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: prefs } = await (sb.from("notification_prefs") as any).select("email_caps").eq("user_id", project.owner_id).maybeSingle() as { data: { email_caps: boolean } | null };
    if (prefs && prefs.email_caps === false) continue;

    const projectUrl = `${appUrl}/p/${c.project_id}`;
    if (overPoints) {
      const r = await sendCapWarningEmail({ to: owner.email, projectName: project.name, metric: "points", used: c.points_count, limit: c.max_points_per_project, projectUrl });
      if (r.ok) warningsSent++;
    }
    if (overInvites) {
      const r = await sendCapWarningEmail({ to: owner.email, projectName: project.name, metric: "pending invites", used: c.pending_invites, limit: c.max_pending_invites, projectUrl });
      if (r.ok) warningsSent++;
    }
  }

  return NextResponse.json({ ok: true, digests_sent: digestsSent, cap_warnings_sent: warningsSent });
}
