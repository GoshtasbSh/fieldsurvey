import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

let cachedTransporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (cachedTransporter) return cachedTransporter;
  const user = (process.env.GMAIL_USER ?? "").trim();
  const pass = (process.env.GMAIL_APP_PASSWORD ?? "").trim().replace(/\s+/g, "");
  if (!user || !pass) {
    throw new Error("GMAIL_USER / GMAIL_APP_PASSWORD not configured");
  }
  cachedTransporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: { user, pass },
  });
  return cachedTransporter;
}

function fromHeader(): string {
  const name = (process.env.EMAIL_FROM_NAME ?? "FieldSurvey").trim();
  const user = (process.env.GMAIL_USER ?? "").trim();
  return `"${name.replace(/"/g, '\\"')}" <${user}>`;
}

export type SendEmailArgs = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
};

export async function sendEmail(
  args: SendEmailArgs,
): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  try {
    const info = await getTransporter().sendMail({
      from: fromHeader(),
      to: Array.isArray(args.to) ? args.to.join(", ") : args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
    });
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Templates ─────────────────────────────────────────────────────────────

export async function sendInviteEmail(args: {
  to: string;
  projectName: string;
  inviterName: string;
  acceptUrl: string;
}) {
  const subject = `${args.inviterName} invited you to ${args.projectName}`;
  const text = [
    `Hello,`,
    ``,
    `${args.inviterName} invited you to the FieldSurvey project "${args.projectName}".`,
    ``,
    `Accept the invite: ${args.acceptUrl}`,
    ``,
    `This link expires in 14 days.`,
    ``,
    `— FieldSurvey`,
  ].join("\n");
  const html = wrap(`
    <p>Hello,</p>
    <p><strong>${esc(args.inviterName)}</strong> invited you to the FieldSurvey project <strong>${esc(args.projectName)}</strong>.</p>
    <p><a href="${args.acceptUrl}" class="btn">Accept invite</a></p>
    <p class="muted">Or paste this URL into your browser: <code>${args.acceptUrl}</code></p>
    <p class="muted">This link expires in 14 days.</p>
  `);
  return sendEmail({ to: args.to, subject, text, html });
}

export async function sendRoleChangeEmail(args: {
  to: string;
  projectName: string;
  newRole: string;
  changerName: string;
  projectUrl: string;
}) {
  const subject = `Your role on ${args.projectName} changed to ${args.newRole}`;
  const text = `${args.changerName} changed your role on "${args.projectName}" to ${args.newRole}.\n\nOpen the project: ${args.projectUrl}\n\n— FieldSurvey`;
  const html = wrap(`
    <p>Hello,</p>
    <p><strong>${esc(args.changerName)}</strong> changed your role on <strong>${esc(args.projectName)}</strong> to <strong>${esc(args.newRole)}</strong>.</p>
    <p><a href="${args.projectUrl}" class="btn">Open project</a></p>
  `);
  return sendEmail({ to: args.to, subject, text, html });
}

export async function sendCapWarningEmail(args: {
  to: string;
  projectName: string;
  metric: string;
  used: number;
  limit: number;
  projectUrl: string;
}) {
  const pct = Math.round((args.used / args.limit) * 100);
  const subject = `${args.projectName} is at ${pct}% of its ${args.metric} cap`;
  const text = `Your project "${args.projectName}" is using ${args.used} of ${args.limit} ${args.metric} (${pct}%).\n\nOpen the project: ${args.projectUrl}\n\n— FieldSurvey`;
  const html = wrap(`
    <p>Hello,</p>
    <p>Your project <strong>${esc(args.projectName)}</strong> is using <strong>${args.used}</strong> of <strong>${args.limit}</strong> ${esc(args.metric)} (<strong>${pct}%</strong>).</p>
    <p class="muted">FieldSurvey blocks new entries at 100%. Plan ahead, archive old projects, or contact us about increased caps.</p>
    <p><a href="${args.projectUrl}" class="btn">Open project</a></p>
  `);
  return sendEmail({ to: args.to, subject, text, html });
}

export type DigestProjectSummary = {
  projectName: string;
  url: string;
  newPoints: number;
  newResponses: number;
  m1: number;
  f1: number;
  r1: number;
};

export async function sendDailyDigestEmail(args: { to: string; period: string; projects: DigestProjectSummary[] }) {
  const totalPoints = args.projects.reduce((a, p) => a + p.newPoints, 0);
  const totalResponses = args.projects.reduce((a, p) => a + p.newResponses, 0);
  const subject = `FieldSurvey · ${args.period} — ${totalPoints} new points, ${totalResponses} new responses`;

  const lines: string[] = [`Hello,`, ``, `Activity in the last 24 hours:`, ``];
  for (const p of args.projects) {
    lines.push(`• ${p.projectName} — +${p.newPoints} points, +${p.newResponses} responses (M1 ${p.m1} · F1 ${p.f1} · R1 ${p.r1})`);
    lines.push(`  ${p.url}`);
  }
  lines.push(``, `— FieldSurvey`);

  const html = wrap(`
    <p>Hello,</p>
    <p>Activity in the last 24 hours:</p>
    <table style="width:100%;border-collapse:collapse">
      ${args.projects.map((p) => `
        <tr><td colspan="2" style="padding-top:14px"><strong><a href="${p.url}" style="color:#38bdf8;text-decoration:none">${esc(p.projectName)}</a></strong></td></tr>
        <tr><td class="muted">New points</td><td style="text-align:right"><strong>+${p.newPoints}</strong></td></tr>
        <tr><td class="muted">New responses</td><td style="text-align:right"><strong>+${p.newResponses}</strong></td></tr>
        <tr><td class="muted">Match status</td><td style="text-align:right">M1 ${p.m1} · F1 ${p.f1} · R1 ${p.r1}</td></tr>
      `).join("")}
    </table>
  `);
  return sendEmail({ to: args.to, subject, text: lines.join("\n"), html });
}

function wrap(body: string): string {
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Inter,sans-serif;background:#0d1117;color:#e6edf3;padding:24px;">
    <div style="max-width:560px;margin:0 auto;background:#161b22;border-radius:12px;padding:28px;">
      <div style="font-family:'Plus Jakarta Sans',sans-serif;font-weight:800;font-size:18px;margin-bottom:18px;">
        field<span style="color:#38bdf8">survey</span>
      </div>
      ${body}
      <p style="color:#8b949e;font-size:12px;margin-top:24px;">— FieldSurvey</p>
    </div>
    <style>
      a.btn { display:inline-block;padding:10px 16px;background:#38bdf8;color:#0d1117;text-decoration:none;border-radius:8px;font-weight:700; }
      .muted { color:#8b949e;font-size:13px; }
      code { font-family:'IBM Plex Mono',monospace;color:#8b949e;font-size:12px; }
    </style>
  </body></html>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}
