"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/client";

/**
 * Subscribes to Realtime changes on points + survey_responses for the project
 * and triggers a router.refresh() so any server-rendered counts/lists update.
 * Coarse but effective for the first M2 cut.
 */
export function RealtimeWatcher({ projectId }: { projectId: string }) {
  const router = useRouter();
  useEffect(() => {
    const sb = createBrowserSupabase();
    const chan = sb
      .channel(`project:${projectId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "points", filter: `project_id=eq.${projectId}` }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "survey_responses", filter: `project_id=eq.${projectId}` }, () => router.refresh())
      .subscribe();
    return () => { void sb.removeChannel(chan); };
  }, [projectId, router]);
  return null;
}
