import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

/**
 * Upload a photo blob to the `point-photos` bucket.
 * Path: {project_id}/{client_point_id}/{photo_id}.{ext}
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
  if (!UUID_RE.test(projectId)) return NextResponse.json({ error: "bad project_id" }, { status: 400 });
  if (!UUID_RE.test(clientPointId)) return NextResponse.json({ error: "bad client_point_id" }, { status: 400 });
  if (!/^[0-9a-f-]{8,60}$/i.test(photoId)) return NextResponse.json({ error: "bad photo_id" }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "file too large" }, { status: 413 });

  // file.type is caller-controlled; whitelist before passing to storage.
  const mime = (file.type || "").toLowerCase();
  const ext = ALLOWED_MIME[mime];
  if (!ext) return NextResponse.json({ error: "unsupported file type" }, { status: 415 });
  const path = `${projectId}/${clientPointId}/${photoId}.${ext}`;

  const { error } = await sb.storage.from("point-photos").upload(path, file, {
    contentType: mime,
    upsert: true, // idempotent retry — same path overwrites
  });
  if (error) return NextResponse.json({ error: "upload failed" }, { status: 500 });

  return NextResponse.json({ path });
}
