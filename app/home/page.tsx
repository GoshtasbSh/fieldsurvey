import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { listHomeCards } from "@/lib/queries/home";
import { HomeTopbar } from "@/components/home/home-topbar";
import { HomeBody } from "@/components/home/home-body";
import { HomeBodyMobile } from "@/components/home/home-body-mobile";
import { detectDeviceServer } from "@/lib/device";
import { readGuestSession } from "@/lib/auth/guest-session";

export default async function HomePage() {
  // Guest auto-route: a valid fs_guest cookie skips the picker entirely.
  // Guests have exactly one project (granted by the daily code) and the
  // friction of a one-option picker is wasted UX. This runs BEFORE the
  // Supabase auth check so a guest in a browser that also has a stale
  // Supabase session doesn't accidentally fall through to the admin home.
  const guest = await readGuestSession();
  if (guest?.projectId) {
    redirect(`/p/${guest.projectId}/m/map`);
  }

  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/sign-in");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const { data: profile } = await sbAny
    .from("profiles")
    .select("display_name, email")
    .eq("id", user.id)
    .maybeSingle();

  const { owned, shared, drafts } = await listHomeCards();
  const device = await detectDeviceServer();

  return (
    <main className="min-h-screen bg-[var(--bento-bg)]">
      <HomeTopbar
        user={{
          email: profile?.email ?? user.email ?? null,
          displayName: profile?.display_name ?? null,
        }}
      />
      {device === "mobile" ? (
        <HomeBodyMobile owned={owned} shared={shared} drafts={drafts} />
      ) : (
        <HomeBody owned={owned} shared={shared} drafts={drafts} />
      )}
    </main>
  );
}
