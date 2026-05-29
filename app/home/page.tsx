import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { listHomeCards } from "@/lib/queries/home";
import { HomeTopbar } from "@/components/home/home-topbar";
import { HomeBody } from "@/components/home/home-body";

export default async function HomePage() {
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

  return (
    <main className="min-h-screen bg-[var(--bento-bg)]">
      <HomeTopbar
        user={{
          email: profile?.email ?? user.email ?? null,
          displayName: profile?.display_name ?? null,
        }}
      />
      <HomeBody owned={owned} shared={shared} drafts={drafts} />
    </main>
  );
}
