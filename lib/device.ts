import { headers, cookies } from "next/headers";

export type DeviceClass = "desktop" | "mobile";
export type OS = "ios" | "android" | "macos" | "windows" | "other";

const MOBILE_UA = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini|Mobile/i;
const DEVICE_COOKIE = "fs_device_pref";

/** Cookie expiry — 30 days. Long enough to be sticky across a survey project, */
/* short enough that a stale "force desktop" from months ago can't haunt a user forever. */
const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

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

/**
 * Read the request's User-Agent and headers without doing the cookie lookup.
 * Used by middleware which has its own headers object — re-reading via
 * next/headers would double the work and miss the request being routed.
 */
export function detectDeviceFromRequest(
  ua: string | null,
  chMobile: string | null,
  prefCookie: string | null,
): DeviceClass {
  if (prefCookie === "desktop" || prefCookie === "mobile") return prefCookie;
  if (chMobile === "?1") return "mobile";
  if (chMobile === "?0") return "desktop";
  return MOBILE_UA.test(ua ?? "") ? "mobile" : "desktop";
}

/**
 * Persist a device preference. Used by:
 *   - /api/device-pref to honor an explicit "view as mobile/desktop" toggle
 *   - the More menu's "Switch to desktop view" action
 *
 * Pass null to clear (returns the user to UA-driven detection).
 */
export async function setDevicePreference(
  device: DeviceClass | null,
): Promise<void> {
  const jar = await cookies();
  if (device === null) {
    jar.delete(DEVICE_COOKIE);
    return;
  }
  jar.set(DEVICE_COOKIE, device, {
    httpOnly: false, // intentionally readable by client device.client.ts
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DEVICE_COOKIE_MAX_AGE,
  });
}
