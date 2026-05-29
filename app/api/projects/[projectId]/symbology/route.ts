/**
 * Symbology overrides for the project's left-rail Status section.
 *
 * Locked Q4 decision:
 *   • Per-status sliders (size px, fill opacity 0..1, outline px).
 *   • Persisted to `project_settings.symbology_overrides` JSONB.
 *   • Shared team-wide (every viewer sees the same paint).
 *   • Owner/admin/surveyor can edit; viewers read-only.
 *
 * GET    /api/projects/:projectId/symbology — read current overrides
 * PATCH  /api/projects/:projectId/symbology — merge partial overrides
 * DELETE /api/projects/:projectId/symbology — reset all to defaults (admin)
 */

import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { z } from "zod";

const DEFAULTS = { size: 8, fill_opacity: 0.85, outline_px: 1.5 };

const StatusOverride = z.object({
  size: z.number().min(2).max(32).optional(),
  fill_opacity: z.number().min(0).max(1).optional(),
  outline_px: z.number().min(0).max(6).optional(),
});
const PatchBody = z.object({
  overrides: z.record(z.string(), StatusOverride.nullable()),
});

async function getRole(projectId: string) {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { sb, user: null, role: null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const { data: role } = await sbAny.rpc("project_role", { p_project: projectId });
  return { sb, user, role: (role as string | null) ?? null };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const { sb, user, role } = await getRole(projectId);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const { data, error } = await sbAny
    .from("project_settings")
    .select("symbology_overrides")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const row = data as { symbology_overrides?: Record<string, unknown> } | null;
  return NextResponse.json({
    defaults: DEFAULTS,
    overrides: (row?.symbology_overrides as Record<string, unknown>) ?? {},
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const { sb, user, role } = await getRole(projectId);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (role !== "owner" && role !== "admin" && role !== "surveyor") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = PatchBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  // Read current, merge, write back. Two-statement pattern keeps the JSONB
  // partial-update simple without a server-side function.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const { data: current, error: readErr } = await sbAny
    .from("project_settings")
    .select("symbology_overrides")
    .eq("project_id", projectId)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });

  const currentRow = current as { symbology_overrides?: Record<string, unknown> } | null;
  const next: Record<string, unknown> = {
    ...((currentRow?.symbology_overrides as Record<string, unknown>) ?? {}),
  };
  for (const [k, v] of Object.entries(parsed.data.overrides)) {
    if (v === null) {
      delete next[k];
    } else {
      next[k] = { ...(next[k] as Record<string, unknown> | undefined), ...v };
    }
  }

  const { error: writeErr } = await sbAny
    .from("project_settings")
    .update({ symbology_overrides: next })
    .eq("project_id", projectId);
  if (writeErr) return NextResponse.json({ error: writeErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, overrides: next });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const { sb, user, role } = await getRole(projectId);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (role !== "owner" && role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const { error } = await sbAny
    .from("project_settings")
    .update({ symbology_overrides: {} })
    .eq("project_id", projectId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, overrides: {} });
}
