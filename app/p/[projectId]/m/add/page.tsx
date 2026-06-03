import { permanentRedirect } from "next/navigation";

/**
 * /m/add was a brief intermediate (S4) — a full-screen add form that
 * auto-captured the user's GPS. That's wrong: surveyors record the
 * location of the door they knocked on, not their own location. The
 * Map tab now uses tap-to-place mode (FAB → tap map → bottom sheet
 * pre-filled with the clicked coords), mirroring the desktop flow.
 *
 * This redirect keeps any stale link or cached bookmark working.
 */
export default async function MobileAddRedirect({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  permanentRedirect(`/p/${projectId}/m/map`);
}
