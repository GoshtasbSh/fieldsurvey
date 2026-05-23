import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { inviteMemberAction, revokeInviteAction } from "./actions";

type MemberRow = {
  user_id: string;
  role: string;
  joined_at: string;
  profiles: { email: string | null; display_name: string | null; avatar_url: string | null } | null;
};

type InviteRow = {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
};

type MeRow = { role: string } | null;

export default async function MembersPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) notFound();

  const { data: memsRaw } = await sb
    .from("project_members")
    .select("user_id, role, joined_at, profiles(email, display_name, avatar_url)")
    .eq("project_id", projectId)
    .returns<MemberRow[]>();
  const mems = (memsRaw ?? []) as MemberRow[];

  const { data: invitesRaw } = await sb
    .from("project_invites")
    .select("id, email, role, expires_at, accepted_at")
    .eq("project_id", projectId)
    .is("accepted_at", null)
    .returns<InviteRow[]>();
  const invites = (invitesRaw ?? []) as InviteRow[];

  const { data: meRaw } = await (sb
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle() as unknown as Promise<{ data: MeRow; error: unknown }>);
  const me = meRaw as MeRow;
  const canManage = me?.role === "owner" || me?.role === "admin";

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="font-display text-2xl font-bold">Members</h1>
      {canManage && (
        <Card className="mt-6">
          <CardHeader>
            <h2 className="font-display text-lg font-bold">Invite member</h2>
          </CardHeader>
          <form
            action={async (fd) => {
              "use server";
              await inviteMemberAction(projectId, fd);
            }}
          >
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="role">Role</Label>
                <select
                  id="role"
                  name="role"
                  defaultValue="surveyor"
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                >
                  <option value="admin">Admin</option>
                  <option value="surveyor">Surveyor</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
              <Button type="submit">Send invite</Button>
            </CardContent>
          </form>
        </Card>
      )}

      <section className="mt-8 space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Members
        </h2>
        {mems.map((m) => (
          <Card key={m.user_id}>
            <CardContent className="flex items-center justify-between py-3">
              <div>
                <div className="font-medium">
                  {m.profiles?.display_name || m.profiles?.email}
                </div>
                <div className="text-xs text-muted-foreground">{m.profiles?.email}</div>
              </div>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">{m.role}</span>
            </CardContent>
          </Card>
        ))}
      </section>

      {canManage && invites.length > 0 && (
        <section className="mt-8 space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Pending invites
          </h2>
          {invites.map((inv) => (
            <Card key={inv.id}>
              <CardContent className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium">{inv.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {inv.role} · expires {new Date(inv.expires_at).toLocaleDateString()}
                  </div>
                </div>
                <form
                  action={async () => {
                    "use server";
                    await revokeInviteAction(projectId, inv.id);
                  }}
                >
                  <Button variant="outline" size="sm">
                    Revoke
                  </Button>
                </form>
              </CardContent>
            </Card>
          ))}
        </section>
      )}
    </main>
  );
}
