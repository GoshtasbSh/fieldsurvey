import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  inviteMemberAction,
  revokeInviteAction,
  removeMemberAction,
  changeMemberRoleAction,
} from "./actions";

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

const ROLE_BADGE: Record<string, string> = {
  owner: "bg-[oklch(78%_0.155_234/0.16)] text-[oklch(78%_0.155_234)] border-[oklch(78%_0.155_234/0.4)]",
  admin: "bg-[oklch(72%_0.18_305/0.16)] text-[oklch(72%_0.18_305)] border-[oklch(72%_0.18_305/0.4)]",
  surveyor: "bg-[oklch(76%_0.16_158/0.16)] text-[oklch(76%_0.16_158)] border-[oklch(76%_0.16_158/0.4)]",
  viewer: "bg-secondary text-secondary-foreground border-border",
};

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
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">Members</h1>
        <span className="rounded-full border border-border bg-secondary px-3 py-1 text-xs font-semibold text-muted-foreground">
          {mems.length} member{mems.length === 1 ? "" : "s"}
        </span>
      </div>

      {canManage && (
        <Card className="mt-6">
          <CardHeader>
            <h2 className="font-display text-lg font-bold">Invite member</h2>
            <p className="text-sm text-muted-foreground">
              They&apos;ll get an email with a one-time link to join this project.
            </p>
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
        {mems.map((m) => {
          const isMe = m.user_id === user.id;
          const isOwner = m.role === "owner";
          const canEditThis = canManage && !isMe && !isOwner;
          return (
            <Card key={m.user_id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {m.profiles?.display_name || m.profiles?.email}
                    {isMe && (
                      <span className="ml-2 rounded-full bg-secondary px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        you
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{m.profiles?.email}</div>
                </div>
                <div className="flex items-center gap-2">
                  {canEditThis ? (
                    <form
                      action={async (fd) => {
                        "use server";
                        await changeMemberRoleAction(projectId, fd);
                      }}
                      className="flex items-center gap-2"
                    >
                      <input type="hidden" name="userId" value={m.user_id} />
                      <select
                        name="role"
                        defaultValue={m.role}
                        className="h-8 rounded-md border bg-background px-2 text-xs"
                      >
                        <option value="admin">Admin</option>
                        <option value="surveyor">Surveyor</option>
                        <option value="viewer">Viewer</option>
                      </select>
                      <Button type="submit" size="sm" variant="outline">
                        Save
                      </Button>
                    </form>
                  ) : (
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                        ROLE_BADGE[m.role] ?? "bg-secondary text-secondary-foreground border-border"
                      }`}
                    >
                      {m.role}
                    </span>
                  )}
                  {canEditThis && (
                    <form
                      action={async () => {
                        "use server";
                        await removeMemberAction(projectId, m.user_id);
                      }}
                    >
                      <Button type="submit" size="sm" variant="outline" className="text-destructive hover:bg-destructive/10">
                        Remove
                      </Button>
                    </form>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
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
