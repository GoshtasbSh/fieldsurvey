import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { z } from "zod";

const Body = z.object({
  project_id: z.string().uuid(),
  point_ids: z.array(z.string().uuid()).min(1).max(1000),
  action: z.enum(["change_status", "reassign", "delete"]),
  status_id: z.string().uuid().optional(),
  collector_id: z.string().uuid().nullable().optional(),
});

/**
 * Bulk-edit selected points. Requires owner/admin role on the project.
 * Always scopes the update by project_id so a malicious payload can't
 * touch another project's rows.
 */
export async function PATCH(req: NextRequest) {
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const { data: role } = await sbAny.rpc("project_role", { p_project: parsed.data.project_id });
  if (role !== "owner" && role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const ids = parsed.data.point_ids;

  if (parsed.data.action === "delete") {
    const { error } = await sbAny.from("points").delete().eq("project_id", parsed.data.project_id).in("id", ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, affected: ids.length });
  }

  if (parsed.data.action === "change_status") {
    if (!parsed.data.status_id) return NextResponse.json({ error: "status_id required" }, { status: 400 });
    const { error } = await sbAny.from("points").update({ status_id: parsed.data.status_id }).eq("project_id", parsed.data.project_id).in("id", ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, affected: ids.length });
  }

  if (parsed.data.action === "reassign") {
    // collector_id may be explicitly null (unassign)
    const { error } = await sbAny.from("points").update({ collector_id: parsed.data.collector_id ?? null }).eq("project_id", parsed.data.project_id).in("id", ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, affected: ids.length });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
