import { headers, cookies } from "next/headers";

export type DeviceClass = "desktop" | "mobile";
export type OS = "ios" | "android" | "macos" | "windows" | "other";

const MOBILE_UA = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini|Mobile/i;
const DEVICE_COOKIE = "fs_device_pref";

export function isMobileUserAgent(ua: string): boolean {
  return MOBILE_UA.test(ua);
}

export function detectOS(ua: string): OS {
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Macintosh/.test(ua)) return "macos";
  if (/Windows/.test(ua)) return "windows";
  return "other";
}

/**
 * Server-side device detection. Priority:
 *   1. fs_device_pref cookie (explicit user override)
 *   2. sec-ch-ua-mobile client hint
 *   3. User-Agent regex
 * Mirrors Keystone's keystone_field_web/login.html::redirectAfterLogin().
 */
export async function detectDeviceServer(): Promise<DeviceClass> {
  const cookieStore = await cookies();
  const pref = cookieStore.get(DEVICE_COOKIE)?.value;
  if (pref === "desktop" || pref === "mobile") return pref;

  const h = await headers();
  const chMobile = h.get("sec-ch-ua-mobile");
  if (chMobile === "?1") return "mobile";
  if (chMobile === "?0") return "desktop";

  return MOBILE_UA.test(h.get("user-agent") || "") ? "mobile" : "desktop";
}

/**
 * Client-side detection. Adds PWA standalone + viewport awareness.
 */
export function detectDeviceClient(): DeviceClass {
  if (typeof window === "undefined") return "desktop";
  const isStandalone =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.navigator as any).standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches;
  if (isStandalone) return "mobile";
  const isMobileUA = MOBILE_UA.test(window.navigator.userAgent);
  const isNarrow = window.innerWidth < 768;
  const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  return isMobileUA || (isNarrow && isTouch) ? "mobile" : "desktop";
}

export const DEVICE_PREF_COOKIE = DEVICE_COOKIE;
