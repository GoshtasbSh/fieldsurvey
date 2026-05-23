"use client";

import { useEffect } from "react";
import { drainOutbox } from "@/lib/offline/sync";

/** Register the service worker on first mount. Listens for outbox:drain
 *  messages from periodic-sync so the queue replays when the OS wakes us. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "outbox:drain") void drainOutbox();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);
  return null;
}
