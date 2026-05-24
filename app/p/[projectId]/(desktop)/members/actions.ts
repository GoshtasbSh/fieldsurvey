"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { sendInviteEmail } from "@/lib/email";

const invite = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "surveyor", "viewer"]),
});

export async function inviteMemberAction(projectId: string, formData: FormData) {
  const parsed = invite.safeParse({ email: formData.get("email"), role: formData.get("role") });
  if (!parsed.success) return { error: "Enter a valid email and role." };

  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data, error } = await sb
    .from("project_invites")
    .insert({
      project_id: projectId,
      email: parsed.data.email,
      role: parsed.data.role,
      invited_by: user.id,
    } as never)
    .select("token")
    .returns<{ token: string }[]>()
    .single();
  if (error || !data) return { error: error?.message ?? "Failed." };

  const { data: projectRaw } = await sb
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .returns<{ name: string }[]>()
    .single();
  const project = projectRaw as { name: string } | null;

  const { data: profileRaw } = await sb
    .from("profiles")
    .select("display_name,email")
    .eq("id", user.id)
    .returns<{ display_name: string | null; email: string }[]>()
    .single();
  const profile = profileRaw as { display_name: string | null; email: string } | null;

  const acceptUrl = `${process.env.NEXT_PUBLIC_APP_URL}/invite/${(data as { token: string }).token}`;
  await sendInviteEmail({
    to: parsed.data.email,
    projectName: project?.name ?? "your project",
    inviterName: profile?.display_name || profile?.email || "Someone",
    acceptUrl,
  });

  revalidatePath(`/p/${projectId}/members`);
  return { ok: true };
}

export async function revokeInviteAction(projectId: string, inviteId: string) {
  const sb = await createServerSupabase();
  const { error } = await sb.from("project_invites").delete().eq("id", inviteId);
  if (error) return { error: error.message };
  revalidatePath(`/p/${projectId}/members`);
  return { ok: true };
}

export async function removeMemberAction(projectId: string, userId: string) {
  const sb = await createServerSupabase();
  const { error } = await sb
    .from("project_members")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", userId);
  if (error) return { error: error.message };
  revalidatePath(`/p/${projectId}/members`);
  return { ok: true };
}

const changeRole = z.object({
  userId: z.string().uuid(),
  role: z.enum(["admin", "surveyor", "viewer"]),
});

export async function changeMemberRoleAction(projectId: string, fd: FormData) {
  const parsed = changeRole.safeParse({ userId: fd.get("userId"), role: fd.get("role") });
  if (!parsed.success) return { error: "Invalid role." };

  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { error: "Not signed in." };

  // Guard: do not let an admin demote/modify the project owner row,
  // and do not let a user modify themselves through this control.
  if (parsed.data.userId === user.id) {
    return { error: "You cannot change your own role." };
  }
  const { data: targetRaw } = await sb
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", parsed.data.userId)
    .maybeSingle();
  const target = targetRaw as { role: string } | null;
  if (target?.role === "owner") {
    return { error: "Owner role cannot be changed." };
  }

  const { error } = await sb
    .from("project_members")
    .update({ role: parsed.data.role } as never)
    .eq("project_id", projectId)
    .eq("user_id", parsed.data.userId);
  if (error) return { error: error.message };
  revalidatePath(`/p/${projectId}/members`);
  return { ok: true };
}
