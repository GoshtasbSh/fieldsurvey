import { createServerSupabase } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function HomeLayout({ children }: { children: React.ReactNode }) {
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/sign-in");
  return <div className="min-h-screen bg-background">{children}</div>;
}
