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
  // Caller-supplied photo id (the IndexedDB outbox blob id). Reusing it as
  // the storage path makes the upload idempotent: a retry overwrites the
  // same object instead of creating a duplicate orphan.
  const photoId = String(form.get("photo_id") ?? "");

  if (!(file instanceof Blob) || !projectId || !clientPointId || !photoId) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }
  if (!/^[0-9a-f-]{8,60}$/i.test(photoId)) return NextResponse.json({ error: "bad photo_id" }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "file too large" }, { status: 413 });

  const ext = (file as File).name?.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${projectId}/${clientPointId}/${photoId}.${ext}`;

  const { error } = await sb.storage.from("point-photos").upload(path, file, {
    contentType: file.type || "image/jpeg",
    upsert: true, // idempotent retry — same path overwrites
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ path });
}
