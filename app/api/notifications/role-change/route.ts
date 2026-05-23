import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { sendRoleChangeEmail } from "@/lib/email";
import { z } from "zod";

const Body = z.object({
  project_id: z.string().uuid(),
  user_id: z.string().uuid(),
  new_role: z.enum(["owner", "admin", "surveyor", "viewer"]),
});

/**
 * Send a role-change email. Caller must be owner/admin of the project.
 * Used by the Members page when it bumps someone's role; respects
 * notification_prefs.email_role for the recipient.
 */
export async function POST(req: NextRequest) {
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const { data: role } = await sbAny.rpc("project_role", { p_project: parsed.data.project_id });
  if (role !== "owner" && role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // Recipient + their prefs
  const { data: target } = await sbAny.from("profiles").select("email, display_name").eq("id", parsed.data.user_id).maybeSingle() as { data: { email: string; display_name: string | null } | null };
  if (!target) return NextResponse.json({ error: "user not found" }, { status: 404 });

  const { data: prefs } = await sbAny.from("notification_prefs").select("email_role").eq("user_id", parsed.data.user_id).maybeSingle() as { data: { email_role: boolean } | null };
  if (prefs && prefs.email_role === false) return NextResponse.json({ ok: true, skipped: "user opted out" });

  const { data: project } = await sbAny.from("projects").select("name").eq("id", parsed.data.project_id).maybeSingle() as { data: { name: string } | null };
  const { data: changer } = await sbAny.from("profiles").select("display_name, email").eq("id", user.id).maybeSingle() as { data: { display_name: string | null; email: string } | null };

  const projectUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/p/${parsed.data.project_id}`;
  const result = await sendRoleChangeEmail({
    to: target.email,
    projectName: project?.name ?? "your project",
    newRole: parsed.data.new_role,
    changerName: changer?.display_name ?? changer?.email?.split("@")[0] ?? "An admin",
    projectUrl,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true });
}
