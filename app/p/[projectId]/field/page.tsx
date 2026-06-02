import { permanentRedirect } from "next/navigation";

/**
 * Back-compat redirect for the pre-M7 mobile route.
 *
 * Old links — guest sign-in's router.replace('/p/<id>/field'), bookmarks,
 * the marketing site's deeplinks — all pointed here before M7 renamed
 * the mobile shell. The new home is /p/<id>/m/map. Using `permanentRedirect`
 * tells crawlers and the browser cache to forget the old URL.
 *
 * Delete once we're confident no stale clients are hitting it (give it
 * one release cycle past M7).
 */
export default async function FieldLegacyRedirect({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  permanentRedirect(`/p/${projectId}/m/map`);
}
