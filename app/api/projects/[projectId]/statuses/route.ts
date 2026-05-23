import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { z } from "zod";

const StatusInput = z.object({
  id: z.string(),
  label: z.string().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  icon: z.string().nullable().optional(),
  sort_order: z.number().int(),
  is_default: z.boolean().optional(),
});
const Body = z.object({ statuses: z.array(StatusInput).min(1).max(40) });

/** PUT /api/projects/:projectId/statuses — replace the project's status set. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const { data: role } = await sbAny.rpc("project_role", { p_project: projectId });
  if (role !== "owner" && role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  // Split into existing-update vs new-insert (id starts with `new_`)
  const newOnes = parsed.data.statuses.filter((s) => s.id.startsWith("new_")).map((s) => ({
    project_id: projectId,
    label: s.label, color: s.color, icon: s.icon ?? null,
    sort_order: s.sort_order, is_default: s.is_default ?? false,
  }));
  const existing = parsed.data.statuses.filter((s) => !s.id.startsWith("new_"));

  // Upsert existing
  for (const s of existing) {
    await sbAny.from("project_statuses").update({
      label: s.label, color: s.color, icon: s.icon ?? null, sort_order: s.sort_order,
    }).eq("id", s.id).eq("project_id", projectId);
  }
  // Insert new
  if (newOnes.length) await sbAny.from("project_statuses").insert(newOnes);

  // Delete any that disappeared
  const keptIds = existing.map((s) => s.id);
  if (keptIds.length) {
    await sbAny.from("project_statuses").delete().eq("project_id", projectId).not("id", "in", `(${keptIds.map((x) => `"${x}"`).join(",")})`);
  }
  return NextResponse.json({ ok: true });
}
