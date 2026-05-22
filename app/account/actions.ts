"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";

export async function updateProfileAction(fd: FormData) {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const displayName = String(fd.get("displayName") || "").slice(0, 80);
  const { error } = await sb
    .from("profiles")
    .update({ display_name: displayName } as never)
    .eq("id", user.id);
  if (error) return { error: error.message };
  revalidatePath("/account");
  return { ok: true };
}

export async function updatePasswordAction(fd: FormData) {
  const password = String(fd.get("password") || "");
  const schema = z.string().min(8).max(72);
  if (!schema.safeParse(password).success) return { error: "Password must be 8+ characters." };
  const sb = await createServerSupabase();
  const { error } = await sb.auth.updateUser({ password });
  if (error) return { error: error.message };
  return { ok: true };
}

export async function deleteAccountAction() {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const admin = createAdminSupabase();
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return { error: error.message };
  await sb.auth.signOut();
  redirect("/");
}

export async function signOutAction() {
  const sb = await createServerSupabase();
  await sb.auth.signOut();
  redirect("/sign-in");
}
