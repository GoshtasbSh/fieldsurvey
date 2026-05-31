import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";

function safeNext(raw: string | null): string {
  if (!raw) return "/home";
  // Must be a same-origin relative path: starts with "/" but not "//" (protocol-relative).
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/home";
  return raw;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));

  if (code) {
    const sb = await createServerSupabase();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, req.url));
  }
  return NextResponse.redirect(new URL("/sign-in?error=callback", req.url));
}
