"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/client";

/**
 * Subscribes to Realtime changes on points + survey_responses for the
 * project and triggers router.refresh() so any server-rendered counts/lists
 * update. Router held via ref so the subscription only churns when the
 * project changes — `useRouter()` returning a new reference per render
 * is an undocumented App-Router implementation detail we don't depend on.
 */
export function RealtimeWatcher({ projectId }: { projectId: string }) {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    const sb = createBrowserSupabase();
    const chan = sb
      .channel(`project:${projectId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "points", filter: `project_id=eq.${projectId}` }, () => routerRef.current.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "survey_responses", filter: `project_id=eq.${projectId}` }, () => routerRef.current.refresh())
      .subscribe();
    return () => { void sb.removeChannel(chan); };
  }, [projectId]);
  return null;
}
