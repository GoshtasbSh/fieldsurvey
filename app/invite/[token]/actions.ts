"use server";
import { createServerSupabase } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function acceptInviteAction(token: string) {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb as any).rpc("accept_invite", { p_token: token });
  if (error) return { error: (error as { message: string }).message };
  redirect(`/p/${data as string}`);
}
