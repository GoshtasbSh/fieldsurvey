/**
 * KeyStone Field — Daily Report Edge Function
 *
 * Triggered daily at 8 PM via Supabase cron (set in dashboard under
 * Database → Functions → Cron → new cron → "0 20 * * *").
 *
 * Queries all field_survey_points, formats as CSV, sends via Resend.
 *
 * Required secrets (set in Supabase Dashboard → Edge Functions → Secrets):
 *   SUPABASE_URL               (auto-available)
 *   SUPABASE_SERVICE_ROLE_KEY  (auto-available)
 *   RESEND_API_KEY             — get free key at resend.com
 *   FROM_EMAIL                 — e.g. "report@keystonesurvey.com" (must be verified in Resend)
 *
 * Deploy:  supabase functions deploy daily-report
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (_req) => {
  try {
    // ── Get all points from the daily_report view ─────────────────────────────
    const { data: points, error: pErr } = await sb
      .from("daily_report")
      .select("*")
      .order("collected_at", { ascending: true });

    if (pErr) throw new Error("Query failed: " + pErr.message);

    // ── Get report email from config table ────────────────────────────────────
    const { data: cfg, error: cErr } = await sb
      .from("report_config")
      .select("email")
      .eq("active", true)
      .single();

    if (cErr || !cfg?.email) throw new Error("No active report email configured");

    // ── Build CSV ─────────────────────────────────────────────────────────────
    const escape = (v: unknown) =>
      String(v ?? "").replace(/,/g, ";").replace(/\n|\r/g, " ").trim();

    const header =
      "ID,Survey Date,Time,Status,Collector,Lat,Lon,Matched Address,Street,Notes\n";

    const rows = (points ?? [])
      .map((p) => {
        const dt = new Date(p.collected_at ?? "");
        const date = dt.toLocaleDateString("en-US");
        const time = dt.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        });
        return [
          escape(p.id),
          date,
          time,
          escape(p.status),
          escape(p.collector_name),
          escape(p.lat),
          escape(p.lon),
          escape(p.matched_address),
          escape(p.street_name),
          escape(p.notes),
        ].join(",");
      })
      .join("\n");

    const csv = header + rows;
    const csvB64 = btoa(unescape(encodeURIComponent(csv)));

    const today = new Date().toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    const todayStr = new Date().toLocaleDateString("en-US");

    const todayCount = (points ?? []).filter((p) => {
      const d = new Date(p.collected_at ?? "");
      return d.toLocaleDateString("en-US") === todayStr;
    }).length;

    // ── Send via Resend ───────────────────────────────────────────────────────
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) throw new Error("RESEND_API_KEY not set");

    const fromEmail =
      Deno.env.get("FROM_EMAIL") ?? "report@keystonesurvey.com";

    const emailBody = {
      from: `KeyStone Field <${fromEmail}>`,
      to: [cfg.email],
      subject: `KeyStone Field Report — ${today}`,
      text: [
        `KeyStone Heights Community Survey — Daily Report`,
        `Date: ${today}`,
        ``,
        `Summary:`,
        `  Total points ever: ${(points ?? []).length}`,
        `  New today:         ${todayCount}`,
        ``,
        `The complete survey history is attached as a CSV file.`,
        ``,
        `— KeyStone Field, DTSC Lab`,
      ].join("\n"),
      attachments: [
        {
          filename: `keystone_survey_${new Date().toISOString().slice(0, 10)}.csv`,
          content: csvB64,
        },
      ],
    };

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emailBody),
    });

    if (!resendRes.ok) {
      const err = await resendRes.text();
      throw new Error("Resend failed: " + err);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        to: cfg.email,
        total_points: (points ?? []).length,
        today_points: todayCount,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("daily-report error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
