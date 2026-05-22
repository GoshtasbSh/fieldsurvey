import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";

export default async function LandingPage() {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (user) redirect("/home");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
      <div className="max-w-xl space-y-6">
        <h1 className="font-display text-4xl font-bold tracking-tight md:text-5xl">
          FieldSurvey
        </h1>
        <p className="text-base text-muted-foreground md:text-lg">
          Run spatial surveys with your team. Collect points in the field, see them on a live map,
          and ship the results.
        </p>
        <div className="flex justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/sign-up">Get started</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/sign-in">Sign in</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
