import { createServerSupabase } from "@/lib/supabase/server";
import { NotificationsForm } from "@/components/account/notifications-form";
import { redirect } from "next/navigation";
import Link from "next/link";

type Prefs = {
  email_invites: boolean;
  email_role: boolean;
  email_digest: boolean;
  email_caps: boolean;
};

export default async function NotificationsPrefsPage() {
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/sign-in?next=/account/notifications");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb.from("notification_prefs") as any)
    .select("email_invites, email_role, email_digest, email_caps")
    .eq("user_id", user.id)
    .maybeSingle() as { data: Prefs | null };

  const prefs: Prefs = data ?? { email_invites: true, email_role: true, email_digest: false, email_caps: true };

  return (
    <main className="mx-auto max-w-2xl px-6 py-10 space-y-6">
      <Link href="/account" className="text-[12px] text-[oklch(58%_0.014_250)] hover:text-[oklch(78%_0.155_234)]">← Back to account</Link>
      <h1 className="font-display text-2xl font-extrabold">Email notifications</h1>
      <p className="text-sm text-[oklch(58%_0.014_250)]">Choose which emails FieldSurvey can send you. Account-critical messages (password reset, sign-in alerts) are always sent.</p>
      <NotificationsForm initial={prefs} />
    </main>
  );
}
