/**
 * POST /api/guest/end
 *
 * Clear the guest session cookie. Idempotent — safe to call even if no
 * cookie exists. Always returns 200.
 */

import "server-only";
import { NextResponse } from "next/server";
import { clearGuestSession } from "@/lib/auth/guest-session";

export async function POST() {
  await clearGuestSession();
  return NextResponse.json({ ok: true });
}
