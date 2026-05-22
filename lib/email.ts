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
  const html = `
    <p>Hello,</p>
    <p><strong>${args.inviterName}</strong> invited you to the FieldSurvey project <strong>${args.projectName}</strong>.</p>
    <p><a href="${args.acceptUrl}" style="display:inline-block;padding:10px 16px;background:#38bdf8;color:#0d1117;text-decoration:none;border-radius:6px;font-weight:600">Accept invite</a></p>
    <p style="color:#8b949e;font-size:13px">Or paste this URL into your browser: <code>${args.acceptUrl}</code></p>
    <p style="color:#8b949e;font-size:13px">This link expires in 14 days.</p>
  `;
  return sendEmail({ to: args.to, subject, text, html });
}
