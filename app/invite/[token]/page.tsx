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
          {/* The invitee themselves can't read their own row under the current
              admin-only SELECT policy, so `invite` is null even for a real
              pending invite. Fall back to a generic "ready to accept" message
              when the user is signed in — the accept_invite RPC server-side
              validates the token, accepted_at, expiry, and email match. */}
          {!invite && !user && (
            <>
              <p className="text-amber-400">
                You need to be signed in to accept this invite.
              </p>
              <p className="text-muted-foreground">
                <Link href={`/sign-up?next=/invite/${token}`} className="underline">
                  Create an account
                </Link>{" "}
                or{" "}
                <Link href={`/sign-in?next=/invite/${token}`} className="underline">
                  sign in
                </Link>
                . Use the email this invite was sent to.
              </p>
            </>
          )}
          {!invite && user && (
            <p className="text-muted-foreground">
              Accept this invite to join the project. We&apos;ll verify it on the server.
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
        {((isValid && user) || (!invite && user)) && (
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
