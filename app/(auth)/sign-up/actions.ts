"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { z } from "zod";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(72),
  displayName: z.string().min(1).max(80).optional(),
});

export type SignUpResult = { error?: string };

export async function signUpAction(formData: FormData): Promise<SignUpResult> {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    displayName: formData.get("displayName") || undefined,
  });
  if (!parsed.success) return { error: "Please enter a valid email and a password (8+ chars)." };

  const sb = await createServerSupabase();
  const { data, error } = await sb.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.displayName },
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
    },
  });
  if (error) return { error: error.message };

  // When email confirmation is OFF in Supabase Auth, signUp returns a live
  // session — log the user straight in and skip the "check email" screen.
  // When confirmation is ON, data.session is null and we route to the
  // check-email page so the user knows to open the inbox.
  if (data.session) redirect("/home");
  redirect("/sign-up/check-email");
}
