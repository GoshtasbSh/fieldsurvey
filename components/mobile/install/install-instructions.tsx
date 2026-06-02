"use client";

import { useEffect, useState } from "react";

type OS = "ios" | "android" | "other";

function detectOS(ua: string): OS {
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "other";
}

/**
 * OS-aware "Add to Home Screen" instructions. iOS Safari has no native
 * install prompt — users must do Share → Add to Home Screen by hand. Android
 * Chrome fires `beforeinstallprompt` which we capture and surface as a
 * button. Falls back to written instructions on `other`.
 *
 * Quiet by design: never auto-prompts (per spec §7.4). Lives in More menu.
 */
export function InstallInstructions() {
  const [os, setOs] = useState<OS>("other");
  const [installed, setInstalled] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setOs(detectOS(window.navigator.userAgent));
    const standalone =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window.navigator as any).standalone === true ||
      window.matchMedia?.("(display-mode: standalone)").matches;
    setInstalled(standalone);

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  if (installed) {
    return (
      <p
        style={{
          fontSize: 13,
          color: "var(--m-success)",
          marginTop: 8,
        }}
      >
        ✓ FieldSurvey is already installed on this device.
      </p>
    );
  }

  if (os === "ios") {
    return (
      <ol
        style={{
          fontSize: 13,
          color: "var(--m-ink-2)",
          lineHeight: 1.6,
          paddingLeft: 22,
          marginTop: 8,
        }}
      >
        <li>
          Tap the <b>Share</b> button at the bottom of Safari.
        </li>
        <li>
          Scroll down and pick <b>Add to Home Screen</b>.
        </li>
        <li>
          Tap <b>Add</b> in the top right.
        </li>
      </ol>
    );
  }

  if (os === "android") {
    if (deferred) {
      return (
        <button
          type="button"
          onClick={async () => {
            deferred.prompt();
            const choice = await deferred.userChoice;
            if (choice.outcome === "accepted") setInstalled(true);
            setDeferred(null);
          }}
          style={{
            marginTop: 8,
            padding: "10px 16px",
            borderRadius: 10,
            background: "var(--m-accent)",
            color: "var(--m-accent-on)",
            border: "none",
            fontSize: 14,
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          Install FieldSurvey
        </button>
      );
    }
    return (
      <ol
        style={{
          fontSize: 13,
          color: "var(--m-ink-2)",
          lineHeight: 1.6,
          paddingLeft: 22,
          marginTop: 8,
        }}
      >
        <li>
          Tap the browser <b>menu</b> button (usually ⋮).
        </li>
        <li>
          Pick <b>Install app</b> or <b>Add to Home screen</b>.
        </li>
        <li>Confirm to add the icon to your home screen.</li>
      </ol>
    );
  }

  return (
    <p
      style={{
        fontSize: 13,
        color: "var(--m-ink-2)",
        marginTop: 8,
        lineHeight: 1.5,
      }}
    >
      Your browser&apos;s menu has an <b>Add to Home Screen</b> option that
      installs FieldSurvey as an app. The exact location varies by browser
      — look for it in the share or menu sheet.
    </p>
  );
}

// Augment the standard event signature; not in lib.dom.d.ts.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
