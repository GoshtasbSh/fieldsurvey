"use server";
import { createServerSupabase } from "@/lib/supabase/server";

export async function resetPasswordAction(formData: FormData) {
  const email = String(formData.get("email") || "");
  if (!email.includes("@")) return { error: "Enter a valid email." };
  const sb = await createServerSupabase();
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/account`,
  });
  if (error) return { error: error.message };
  return { ok: true };
}
