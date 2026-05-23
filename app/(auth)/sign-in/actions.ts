"use server";
import { createServerSupabase } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { z } from "zod";

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function signInAction(formData: FormData) {
  const parsed = schema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "Enter a valid email and password." };

  const sb = await createServerSupabase();
  const { error } = await sb.auth.signInWithPassword(parsed.data);
  if (error) {
    const msg = error.message.toLowerCase().includes("email not confirmed")
      ? "Email not confirmed. Ask the admin to enable instant sign-in, or check your inbox for the confirmation link."
      : error.message;
    return { error: msg };
  }
  redirect("/home");
}

export async function magicLinkAction(formData: FormData) {
  const email = String(formData.get("email") || "");
  if (!email) return { error: "Enter your email." };
  const sb = await createServerSupabase();
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback` },
  });
  if (error) return { error: error.message };
  return { ok: true };
}
