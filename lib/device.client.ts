/**
 * Client-safe device constants and detection. Split from lib/device.ts
 * because that file imports `next/headers` (server-only) and would
 * poison any client component that needed `DEVICE_PREF_COOKIE`.
 */
export const DEVICE_PREF_COOKIE = "fs_device_pref";

const MOBILE_UA = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini|Mobile/i;

export type DeviceClass = "desktop" | "mobile";

export function detectDeviceClient(): DeviceClass {
  if (typeof window === "undefined") return "desktop";
  // navigator.standalone exists on iOS Safari but isn't in lib.dom.d.ts
  const nav = window.navigator as Navigator & { standalone?: boolean };
  const isStandalone =
    nav.standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches;
  const isMobileUA = MOBILE_UA.test(window.navigator.userAgent);
  // Standalone alone isn't enough — Chrome on macOS/Windows can install
  // PWAs in standalone mode too, and we don't want a MacBook admin to be
  // dropped into the mobile shell with no escape. Require a mobile UA
  // *and* standalone to short-circuit; otherwise fall through to the
  // narrow+touch heuristics below.
  if (isStandalone && isMobileUA) return "mobile";
  const isNarrow = window.innerWidth < 768;
  const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  return isMobileUA || (isNarrow && isTouch) ? "mobile" : "desktop";
}
