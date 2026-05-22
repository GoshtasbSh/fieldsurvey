import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { acceptInviteAction } from "./actions";

type InviteData = {
  email: string;
  role: string;
  accepted_at: string | null;
  expires_at: string;
  projects: { name: string } | { name: string }[] | null;
};

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();

  const { data: inviteRaw } = await sb
    .from("project_invites")
    .select("email, role, accepted_at, expires_at, projects(name)")
    .eq("token", token)
    .returns<InviteData[]>()
    .maybeSingle();
  const invite = inviteRaw as InviteData | null;

  const projectName = invite?.projects
    ? Array.isArray(invite.projects)
      ? invite.projects[0]?.name
      : invite.projects.name
    : undefined;

  const isExpired = invite
    ? !invite.accepted_at && new Date(invite.expires_at) < new Date()
    : false;
  const isValid =
    invite !== null && !invite.accepted_at && !isExpired;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="font-display text-2xl">Project invite</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {!invite && (
            <p className="text-destructive">
              This invite is invalid or no longer exists.
            </p>
          )}
          {invite?.accepted_at && (
            <p className="text-muted-foreground">This invite was already accepted.</p>
          )}
          {invite && isExpired && (
            <p className="text-destructive">This invite has expired.</p>
          )}
          {isValid && (
            <>
              <p>
                You were invited to <strong>{projectName}</strong> as{" "}
                <strong>{invite.role}</strong>.
              </p>
              <p className="text-muted-foreground">
                The invite was sent to{" "}
                <code className="font-mono">{invite.email}</code>.
              </p>
              {!user && (
                <p className="text-amber-400">
                  Please{" "}
                  <Link
                    href={`/sign-up?next=/invite/${token}`}
                    className="underline"
                  >
                    create an account
                  </Link>{" "}
                  with that email, or{" "}
                  <Link
                    href={`/sign-in?next=/invite/${token}`}
                    className="underline"
                  >
                    sign in
                  </Link>
                  .
                </p>
              )}
            </>
          )}
        </CardContent>
        {isValid && user && (
          <CardFooter>
            <form
              action={async () => {
                "use server";
                await acceptInviteAction(token);
              }}
              className="w-full"
            >
              <Button type="submit" className="w-full">
                Accept invite
              </Button>
            </form>
          </CardFooter>
        )}
      </Card>
    </main>
  );
}
