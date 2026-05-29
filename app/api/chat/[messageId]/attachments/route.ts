/**
 * POST /api/chat/:messageId/attachments
 *
 * Insert N attachment metadata rows for a chat message after the client
 * has already uploaded the file blobs to the `chat-attachments` Storage
 * bucket (RLS handled by the bucket policies from migration 007).
 *
 * Locked Q6 decision: images only, 10 MB per file, multi-attachment per
 * message via the join table.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { z } from "zod";

const Attachment = z.object({
  path: z.string().min(1).max(512),
  mime: z.enum([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
    "image/gif",
  ]),
  size: z.number().int().positive().max(10 * 1024 * 1024),
  name: z.string().min(1).max(256),
  width_px: z.number().int().positive().max(20_000).optional(),
  height_px: z.number().int().positive().max(20_000).optional(),
});
const Body = z.object({
  attachments: z.array(Attachment).min(1).max(10),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ messageId: string }> },
) {
  const { messageId } = await params;
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  // Confirm the caller authored the message — defense in depth alongside RLS.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const { data: msgRaw, error: msgErr } = await sbAny
    .from("chat_messages")
    .select("id, project_id, author_id")
    .eq("id", messageId)
    .maybeSingle();
  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 });
  const msg = msgRaw as { id: string; project_id: string; author_id: string } | null;
  if (!msg) return NextResponse.json({ error: "message not found" }, { status: 404 });
  if (msg.author_id !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  // Validate each path's first segment matches the message's project_id.
  for (const a of parsed.data.attachments) {
    const segs = a.path.split("/");
    if (segs[0] !== msg.project_id) {
      return NextResponse.json(
        { error: "path project_id mismatch" },
        { status: 400 },
      );
    }
    if (segs[1] !== messageId) {
      return NextResponse.json(
        { error: "path message_id mismatch" },
        { status: 400 },
      );
    }
  }

  const rows = parsed.data.attachments.map((a) => ({
    message_id: messageId,
    path: a.path,
    mime: a.mime,
    size: a.size,
    name: a.name,
    width_px: a.width_px ?? null,
    height_px: a.height_px ?? null,
  }));
  const { data, error } = await sbAny
    .from("chat_message_attachments")
    .insert(rows)
    .select("id, path, mime, size, name, width_px, height_px");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ attachments: data ?? [] });
}
