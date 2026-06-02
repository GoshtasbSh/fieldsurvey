import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { detectDeviceFromRequest, DEVICE_PREF_COOKIE } from "@/lib/device";
import { targetForDevice } from "@/lib/mobile/surface-map";

/**
 * FieldSurvey middleware.
 *
 * Two responsibilities:
 *   1. Refresh the Supabase auth session cookies on every request so
 *      server-rendered pages have a live user.
 *   2. Attach a Content-Security-Policy (and the related hardening headers)
 *      to the response.
 *
 * CSP lessons baked in (per KeyStone audit §8 — implemented day-one to
 * avoid the 4 redeploys it took KeyStone to get right):
 *
 *   • MapLibre fetches raster tiles via the Fetch API, so tile hosts must
 *     be in `connect-src` — NOT just `img-src`.
 *   • Include APEX hosts (e.g. `arcgisonline.com`) alongside the `*.`
 *     wildcards. Some tile CDNs serve from the apex on retry.
 *   • Style CDN host belongs in `style-src` (Google Fonts CSS lives at
 *     `fonts.googleapis.com`).
 *   • The service worker is registered from `/sw.js` (same-origin),
 *     so `worker-src 'self'` is required.
 *   • Supabase realtime uses WebSockets — `wss://*.supabase.co`.
 *   • OpenStreetMap Nominatim (geocoder) — `nominatim.openstreetmap.org`.
 *   • US Census geocoder used server-side via Python — not needed in CSP.
 */

const SUPABASE_HOST = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host
  : null;

function buildCsp(): string {
  const supabase = SUPABASE_HOST ?? "*.supabase.co";

  // connect-src: any host the client may `fetch()` from. Includes raster tile
  // hosts (MapLibre uses Fetch under the hood), Supabase REST + realtime,
  // and Nominatim. Apex + wildcard pairs are intentional.
  const connect = [
    "'self'",
    "data:",
    "blob:",
    `https://${supabase}`,
    `wss://${supabase}`,
    "https://*.supabase.co",
    "wss://*.supabase.co",
    // Esri / ArcGIS — satellite + topo basemaps
    "https://server.arcgisonline.com",
    "https://services.arcgisonline.com",
    "https://*.arcgisonline.com",
    // Carto — light / streets basemaps
    "https://*.basemaps.cartocdn.com",
    "https://cartodb-basemaps-a.global.ssl.fastly.net",
    "https://cartodb-basemaps-b.global.ssl.fastly.net",
    "https://cartodb-basemaps-c.global.ssl.fastly.net",
    "https://cartodb-basemaps-d.global.ssl.fastly.net",
    // OpenStreetMap raster + Nominatim geocoder
    "https://*.tile.openstreetmap.org",
    "https://tile.openstreetmap.org",
    "https://nominatim.openstreetmap.org",
    // OpenTopoMap
    "https://*.tile.opentopomap.org",
    // Google Fonts (the font binaries themselves are served from fonts.gstatic)
    "https://fonts.gstatic.com",
  ].join(" ");

  const imgSrc = [
    "'self'",
    "data:",
    "blob:",
    "https:",
  ].join(" ");

  const styleSrc = [
    "'self'",
    "'unsafe-inline'", // Tailwind + shadcn rely on inline style attributes
    "https://fonts.googleapis.com",
  ].join(" ");

  const scriptSrc = [
    "'self'",
    "'unsafe-inline'", // Next.js inline hydration runtime
    "'unsafe-eval'",   // MapLibre + some chart libs use Function() under the hood
  ].join(" ");

  const fontSrc = [
    "'self'",
    "data:",
    "https://fonts.gstatic.com",
  ].join(" ");

  const policy = [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `style-src ${styleSrc}`,
    `img-src ${imgSrc}`,
    `font-src ${fontSrc}`,
    `connect-src ${connect}`,
    `worker-src 'self' blob:`,
    `media-src 'self' blob:`,
    `frame-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ];
  return policy.join("; ");
}

function applySecurityHeaders(res: NextResponse): NextResponse {
  // CSP — toggle to Report-Only by replacing the header name during a
  // staging rollout. Production runs enforcing.
  res.headers.set("Content-Security-Policy", buildCsp());

  // HSTS — only meaningful over HTTPS; harmless on HTTP localhost.
  res.headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains; preload",
  );

  // Permissions-Policy — opt out of features we don't need so the browser
  // refuses access even if a dependency tries to request it. Geolocation +
  // camera ARE used (field PWA), so we keep them on 'self'.
  res.headers.set(
    "Permissions-Policy",
    [
      "geolocation=(self)",
      "camera=(self)",
      "microphone=()",
      "payment=()",
      "usb=()",
      "magnetometer=()",
      "gyroscope=()",
      "accelerometer=()",
    ].join(", "),
  );

  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("X-Frame-Options", "DENY");

  return res;
}

export async function middleware(request: NextRequest) {
  // Device-class routing — runs first so we don't pay the Supabase session
  // cost on a request that's about to be redirected. We use the surface-map
  // helper which is the single source of truth for desktop↔mobile routes;
  // adding a new surface only requires updating lib/mobile/surface-map.ts.
  const device = detectDeviceFromRequest(
    request.headers.get("user-agent"),
    request.headers.get("sec-ch-ua-mobile"),
    request.cookies.get(DEVICE_PREF_COOKIE)?.value ?? null,
  );
  const target = targetForDevice(request.nextUrl.pathname, device);
  if (target) {
    const redirectUrl = new URL(target, request.url);
    redirectUrl.search = request.nextUrl.search;
    return applySecurityHeaders(NextResponse.redirect(redirectUrl, 307));
  }

  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    // Env not configured (e.g. CI without secrets, build-time). Pass through
    // so the dev server can still boot. Auth-gated pages will redirect to
    // /sign-in via their own server-side checks. Still apply security headers
    // so deploys without env vars don't ship without them.
    return applySecurityHeaders(response);
  }

  const supabase = createServerClient(
    url,
    anon,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet: { name: string; value: string; options: CookieOptions }[]) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  await supabase.auth.getUser();
  return applySecurityHeaders(response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)"],
};
