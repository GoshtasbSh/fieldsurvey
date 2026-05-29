/**
 * Guest day-codes admin (M5).
 *
 * GET  — list non-revoked, non-expired codes for the project (owner/admin only).
 * POST — issue a new code: { label? } → returns the row including the code text.
 *
 * The code is a 6-character random string drawn from an unambiguous alphabet
 * (no 0/O/1/I/L). Collisions inside a single project are caught by the
 * partial unique index from migration 010; we retry a small number of times.
 */

import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { createServerSupabase } from "@/lib/supabase/server";

const PostBody = z.object({
  label: z.string().min(1).max(120).optional().nullable(),
});

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 31 chars; no 0/O/1/I/L
const CODE_LENGTH = 6;
const MAX_INSERT_RETRIES = 5;

function generateCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

async function getRole(projectId: string) {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { sb, user: null, role: null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: role } = await (sb as any).rpc("project_role", { p_project: projectId });
  return { sb, user, role: (role as string | null) ?? null };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { sb, user, role } = await getRole(projectId);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (role !== "owner" && role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb.from("guest_sessions") as any)
    .select("id, code, label, issued_at, expires_at, revoked_at")
    .eq("project_id", projectId)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("issued_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ codes: data ?? [] });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { sb, user, role } = await getRole(projectId);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (role !== "owner" && role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = PostBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;

  for (let attempt = 0; attempt < MAX_INSERT_RETRIES; attempt++) {
    const code = generateCode();
    const { data, error } = await sbAny
      .from("guest_sessions")
      .insert({
        project_id: projectId,
        code,
        label: parsed.data.label ?? null,
        issued_by: user.id,
      })
      .select("id, code, label, issued_at, expires_at, revoked_at")
      .single();

    if (!error && data) {
      return NextResponse.json({ code: data });
    }
    if (error?.code === "23505") {
      // Unique-violation on (project_id, code) — try again with a new code.
      continue;
    }
    return NextResponse.json(
      { error: error?.message ?? "failed to issue code" },
      { status: 500 },
    );
  }
  return NextResponse.json(
    { error: "could not generate a unique code; try again" },
    { status: 500 },
  );
}
