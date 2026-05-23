import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { z } from "zod";

const PostBody = z.object({
  project_id: z.string().uuid(),
  body: z.string().min(1).max(4000),
  mentions: z.array(z.string().uuid()).max(20).optional(),
});

/** Send a chat message to a project. Author defaults to auth.uid() via RLS. */
export async function POST(req: NextRequest) {
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = PostBody.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb.from("chat_messages") as any)
    .insert({
      project_id: parsed.data.project_id,
      author_id: user.id,
      body: parsed.data.body,
      mentions: parsed.data.mentions ?? [],
    })
    .select("id")
    .single() as { data: { id: string } | null; error: { message: string } | null };

  if (error || !data) return NextResponse.json({ error: error?.message ?? "insert failed" }, { status: 500 });
  return NextResponse.json({ id: data.id });
}
