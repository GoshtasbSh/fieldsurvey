import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Upload a photo blob to the `point-photos` bucket.
 * Path: {project_id}/{client_point_id}/{uuid}-{filename}
 * RLS on storage.objects enforces project membership.
 *
 * Returns { path } for the caller to attach to a point row later.
 */
export async function POST(req: NextRequest) {
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  const projectId = String(form.get("project_id") ?? "");
  const clientPointId = String(form.get("client_point_id") ?? "");

  if (!(file instanceof Blob) || !projectId || !clientPointId) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "file too large" }, { status: 413 });

  const ext = (file as File).name?.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${projectId}/${clientPointId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await sb.storage.from("point-photos").upload(path, file, {
    contentType: file.type || "image/jpeg",
    upsert: false,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ path });
}
