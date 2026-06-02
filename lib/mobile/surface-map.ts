/**
 * Surface mapping table — central source of truth for which desktop URL
 * corresponds to which mobile URL (and vice versa) under a project.
 *
 * Used by middleware to enforce device-class routing: a mobile UA hitting
 * `/p/[id]/responses` is redirected to `/p/[id]/m/survey`, and a desktop UA
 * hitting `/p/[id]/m/survey` is redirected to `/p/[id]/responses`. Mobile-
 * only surfaces (chat, report, more, analysis) have no desktop counterpart
 * and are left alone for desktop visitors (they can render on desktop, we
 * just never force them to).
 *
 * Why a string-string map rather than enums: the surface segment is a URL
 * path component and the maps are read by middleware (which runs on the
 * edge and benefits from plain-object lookups), the role gate, the link
 * helpers, and the test harness. Keeping them as constants makes mismatches
 * impossible to type-check away.
 */

/** Desktop surfaces that have a mobile equivalent. */
export const DESKTOP_SURFACES = [
  "map",
  "points",
  "responses",
  "members",
  "settings",
  "import",
] as const;

export type DesktopSurface = (typeof DESKTOP_SURFACES)[number];

/** Mobile surfaces — superset of desktop equivalents plus mobile-only ones. */
export const MOBILE_SURFACES = [
  "map",
  "points",
  "survey",
  "chat",
  "more",
  "report",
  "analysis",
  "members",
  "settings",
  "import",
  "reports",
  "add",
] as const;

export type MobileSurface = (typeof MOBILE_SURFACES)[number];

/** Desktop → mobile surface name. */
export const MOBILE_SURFACE_MAP: Record<DesktopSurface, MobileSurface> = {
  map: "map",
  points: "points",
  responses: "survey",
  members: "members",
  settings: "settings",
  import: "import",
};

/** Mobile → desktop surface name (only for surfaces that have a desktop equivalent). */
export const DESKTOP_SURFACE_MAP: Partial<Record<MobileSurface, DesktopSurface>> = {
  map: "map",
  points: "points",
  survey: "responses",
  members: "members",
  settings: "settings",
  import: "import",
  // chat, more, report, analysis, reports, add are mobile-only and stay on mobile.
};

const PROJECT_RE = /^\/p\/([^/]+)\/(.+?)\/?$/;
const MOBILE_PREFIX = "m";

export type SurfaceParse = {
  projectId: string;
  surface: string;
  isMobile: boolean;
  trailingSlash: boolean;
};

/**
 * Parse a project URL into its parts. Returns null for non-project paths.
 * Handles both /p/[id]/<surface> (desktop) and /p/[id]/m/<surface> (mobile).
 *
 * Accepts a pathname with an optional query string or fragment; both are
 * stripped before matching so callers in tests / future code paths that
 * pass `window.location.href`-like strings don't silently produce a
 * surface name like "map?foo=bar" that fails the surface lookup.
 */
export function parseProjectPath(pathname: string): SurfaceParse | null {
  const qIdx = pathname.indexOf("?");
  if (qIdx !== -1) pathname = pathname.slice(0, qIdx);
  const hIdx = pathname.indexOf("#");
  if (hIdx !== -1) pathname = pathname.slice(0, hIdx);
  const m = pathname.match(PROJECT_RE);
  if (!m) return null;
  const [, projectId, rest] = m;
  const trailingSlash = pathname.endsWith("/") && pathname.length > 1;
  const parts = rest.split("/").filter(Boolean);
  if (parts[0] === MOBILE_PREFIX) {
    if (parts.length < 2) return null;
    return { projectId, surface: parts[1], isMobile: true, trailingSlash };
  }
  return { projectId, surface: parts[0], isMobile: false, trailingSlash };
}

/** Build the canonical desktop URL for a project surface. */
export function desktopProjectUrl(projectId: string, surface: DesktopSurface): string {
  return `/p/${projectId}/${surface}`;
}

/** Build the canonical mobile URL for a project surface. */
export function mobileProjectUrl(projectId: string, surface: MobileSurface): string {
  return `/p/${projectId}/m/${surface}`;
}

/**
 * Given a request path + a device class, return the URL the user should be
 * on. Returns null if the current path is already correct (no redirect).
 *
 *   /p/X/responses + mobile  → /p/X/m/survey
 *   /p/X/m/survey  + desktop → /p/X/responses
 *   /p/X/m/chat    + desktop → null      (mobile-only surface, fine to render)
 *   /p/X/m/map     + mobile  → null      (already correct)
 *   /sign-in                 → null      (not a project path)
 */
export function targetForDevice(
  pathname: string,
  device: "mobile" | "desktop",
): string | null {
  const parsed = parseProjectPath(pathname);
  if (!parsed) return null;
  const { projectId, surface, isMobile } = parsed;

  if (device === "mobile" && !isMobile) {
    const mob = MOBILE_SURFACE_MAP[surface as DesktopSurface];
    if (!mob) return null;
    return mobileProjectUrl(projectId, mob);
  }

  if (device === "desktop" && isMobile) {
    const desk = DESKTOP_SURFACE_MAP[surface as MobileSurface];
    if (!desk) return null;
    return desktopProjectUrl(projectId, desk);
  }

  return null;
}
