import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MembersList, type MemberRow } from "@/components/members/members-list";
import {
  inviteMemberAction,
  revokeInviteAction,
  removeMemberAction,
  changeMemberRoleAction,
} from "./actions";

type InviteRow = {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
};

type MeRow = { role: string } | null;

const ROLE_BADGE: Record<string, { bg: string; color: string }> = {
  owner: { bg: "var(--bento-accent-soft)", color: "var(--bento-accent)" },
  admin: { bg: "var(--bento-magenta-soft)", color: "var(--bento-magenta)" },
  surveyor: { bg: "var(--bento-success-soft)", color: "var(--bento-success)" },
  viewer: { bg: "var(--bento-surface-2)", color: "var(--bento-ink-2)" },
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

  // Pre-render per-row server-action forms; the client component embeds them.
  const rowActions: Record<string, React.ReactNode> = {};
  for (const m of mems) {
    const isMe = m.user_id === user.id;
    const isOwner = m.role === "owner";
    const canEditThis = canManage && !isMe && !isOwner;
    const badge = ROLE_BADGE[m.role] ?? ROLE_BADGE.viewer;
    rowActions[m.user_id] = (
      <>
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
              className="h-8 rounded-[10px] border border-[var(--bento-rule)] bg-[var(--bento-surface)] px-2 text-xs text-[var(--bento-ink-1)]"
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
            className="rounded-full border border-transparent px-2.5 py-0.5 text-[11px] font-semibold"
            style={{ background: badge.bg, color: badge.color }}
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
            <Button
              type="submit"
              size="sm"
              variant="outline"
              className="text-[var(--bento-danger)] hover:bg-[var(--bento-danger-soft)]"
            >
              Remove
            </Button>
          </form>
        )}
      </>
    );
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-[var(--bento-ink-1)]">
            Members
          </h1>
          <p className="mt-1 text-[12px] text-[var(--bento-ink-3)]">
            Online indicator is live from the project presence channel.
          </p>
        </div>
        <span className="bento-chip">
          {mems.length} member{mems.length === 1 ? "" : "s"}
        </span>
      </div>

      {canManage && (
        <div className="bento-panel p-5">
          <h2 className="font-display text-lg font-bold text-[var(--bento-ink-1)]">
            Invite member
          </h2>
          <p className="mt-1 text-sm text-[var(--bento-ink-3)]">
            They&apos;ll get an email with a one-time link to join this project.
          </p>
          <form
            action={async (fd) => {
              "use server";
              await inviteMemberAction(projectId, fd);
            }}
            className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
          >
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
                className="h-9 rounded-[10px] border border-[var(--bento-rule)] bg-[var(--bento-surface)] px-3 text-sm text-[var(--bento-ink-1)]"
              >
                <option value="admin">Admin</option>
                <option value="surveyor">Surveyor</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>
            <Button type="submit">Send invite</Button>
          </form>
        </div>
      )}

      <section className="space-y-2">
        <h2 className="bento-label">Members</h2>
        <MembersList
          projectId={projectId}
          currentUserId={user.id}
          members={mems}
          rowActions={rowActions}
        />
      </section>

      {canManage && invites.length > 0 && (
        <section className="space-y-2">
          <h2 className="bento-label">Pending invites</h2>
          {invites.map((inv) => (
            <div key={inv.id} className="bento-panel flex items-center justify-between p-3.5">
              <div>
                <div className="text-[13px] font-semibold text-[var(--bento-ink-1)]">
                  {inv.email}
                </div>
                <div className="text-[11px] text-[var(--bento-ink-3)]">
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
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
