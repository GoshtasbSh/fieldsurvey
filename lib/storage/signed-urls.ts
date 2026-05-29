/**
 * Signed-URL helpers for Supabase Storage.
 *
 * KeyStone §8 lesson: prefer short-lived signed URLs for private buckets
 * over relying solely on Storage RLS. RLS catches the bypass attempt at
 * the row layer; signed URLs add a time-bound HTTP credential so a leaked
 * URL stops working an hour later.
 *
 * Used by:
 *   • Desktop point-photo lightbox (rendering)
 *   • Mobile point-sheet photo strip
 *   • /api/export/my-data — semi-colon-joined column of 7-day URLs
 *   • Chat attachments lightbox (1-hour TTL by default)
 *
 * Server-only. Don't import this from client components — it requires a
 * Supabase server client (anon or service) and must run in a route handler
 * / server action / RSC where cookies-based auth is available.
 */

import { createServerSupabase } from "@/lib/supabase/server";

const DEFAULT_TTL_SECONDS = 60 * 60; // 1 hour

export type SignedUrl = {
  path: string;
  url: string;
  /** UNIX ms expiry — for client-side caching / refresh decisions. */
  expires_at: number;
};

/**
 * Sign a single object path. Returns null when the path can't be signed
 * (RLS denied, missing, expired) so the caller can render a placeholder.
 */
export async function signOne(
  bucket: string,
  path: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<SignedUrl | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, ttlSeconds);
  if (error || !data?.signedUrl) return null;
  return {
    path,
    url: data.signedUrl,
    expires_at: Date.now() + ttlSeconds * 1000,
  };
}

/**
 * Batch-sign many paths in one Storage call. Order is preserved; failures
 * surface as `null` in the matching slot so the caller can map() the array
 * back over its source rows without re-aligning indices.
 */
export async function signMany(
  bucket: string,
  paths: string[],
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<(SignedUrl | null)[]> {
  if (paths.length === 0) return [];
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrls(paths, ttlSeconds);
  if (error || !data) return paths.map(() => null);
  const expires_at = Date.now() + ttlSeconds * 1000;
  // The SDK preserves input order in `data`. Map by index to be safe.
  return paths.map((path, i) => {
    const row = data[i];
    if (!row?.signedUrl) return null;
    return { path, url: row.signedUrl, expires_at };
  });
}

/**
 * Convenience for the most common case — sign every point-photo for a point.
 */
export async function signPointPhotos(paths: string[]): Promise<(SignedUrl | null)[]> {
  return signMany("point-photos", paths, DEFAULT_TTL_SECONDS);
}

/**
 * Sign chat-attachment paths with the locked 1-hour TTL (Q6 decision).
 */
export async function signChatAttachments(paths: string[]): Promise<(SignedUrl | null)[]> {
  return signMany("chat-attachments", paths, DEFAULT_TTL_SECONDS);
}

/**
 * 7-day TTL helper used by /api/export/my-data — the surveyor receives a
 * CSV row with `photo_urls` semi-colon-joined URLs valid for 7 days
 * (Q3 decision: "Signed URLs in a CSV column").
 */
export async function signForWeeklyExport(
  bucket: string,
  paths: string[],
): Promise<(SignedUrl | null)[]> {
  return signMany(bucket, paths, 7 * 24 * 60 * 60);
}
