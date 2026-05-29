/**
 * POST /api/guest/start
 *
 * Trade a day-code for a guest session cookie.
 *
 * Body: { code: string }
 * Response 200: { ok: true, projectId, expiresAt }
 * Response 401: { ok: false, error: "Invalid or expired code" }
 *
 * The validate_guest_code RPC is service-role only (see migration 010), so
 * this route uses the admin client. We never expose the RPC to anon clients
 * because that would let anyone iterate codes.
 */

import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { setGuestSession } from "@/lib/auth/guest-session";

const Body = z.object({
  code: z.string().trim().min(1).max(64),
});

type ValidateRow = {
  session_id: string;
  project_id: string;
  expires_at: string;
};

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Missing code" }, { status: 400 });
  }

  const admin = createAdminSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any).rpc("validate_guest_code", {
    p_code: parsed.data.code,
  });

  if (error) {
    return NextResponse.json(
      { ok: false, error: "Guest validation failed" },
      { status: 500 },
    );
  }

  const rows = (data ?? []) as ValidateRow[];
  const row = rows[0];
  if (!row) {
    return NextResponse.json(
      { ok: false, error: "Invalid or expired code" },
      { status: 401 },
    );
  }

  await setGuestSession({
    sessionId: row.session_id,
    projectId: row.project_id,
    expiresAt: row.expires_at,
  });

  return NextResponse.json({
    ok: true,
    projectId: row.project_id,
    expiresAt: row.expires_at,
  });
}
