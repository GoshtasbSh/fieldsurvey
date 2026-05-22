export type OS = "ios" | "android" | "macos" | "windows" | "other";

export function isMobileUserAgent(ua: string): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}

export function detectOS(ua: string): OS {
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Macintosh/.test(ua)) return "macos";
  if (/Windows/.test(ua)) return "windows";
  return "other";
}

export function detectClient(ua: string, viewportWidth: number, isTouch: boolean) {
  const mobileUA = isMobileUserAgent(ua);
  const narrow = viewportWidth < 768;
  const isMobile = mobileUA || (narrow && isTouch);
  return { isMobile, os: detectOS(ua) };
}
