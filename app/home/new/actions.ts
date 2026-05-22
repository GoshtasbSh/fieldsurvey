"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import type { TablesInsert } from "@/lib/db.types";

const schema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(1000).optional(),
  centerLat: z.coerce.number().gte(-90).lte(90),
  centerLon: z.coerce.number().gte(-180).lte(180),
  defaultZoom: z.coerce.number().int().min(1).max(22).default(14),
});

export async function createProjectAction(formData: FormData) {
  const parsed = schema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    centerLat: formData.get("centerLat"),
    centerLon: formData.get("centerLon"),
    defaultZoom: formData.get("defaultZoom") || 14,
  });
  if (!parsed.success) return { error: "Fill in name and a valid map location." };

  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const payload: TablesInsert<"projects"> = {
    owner_id: user.id,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    center_lat: parsed.data.centerLat,
    center_lon: parsed.data.centerLon,
    default_zoom: parsed.data.defaultZoom,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb.from("projects") as any)
    .insert(payload)
    .select("id")
    .single();

  if (error || !data) return { error: (error as { message?: string } | null)?.message ?? "Failed to create project." };
  redirect(`/p/${(data as { id: string }).id}`);
}
