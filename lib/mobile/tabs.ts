import type { ProjectRole } from "@/lib/mobile/role-gate";
import type { MobileSurface } from "@/lib/mobile/surface-map";

/**
 * Tab metadata for the mobile bottom-tab bar.
 *
 * `id` matches a MobileSurface, which keeps the URL builder, the tab bar,
 * and the role gate all referring to the same string identifier. Adding a
 * tab requires adding the surface to MOBILE_SURFACES (lib/mobile/surface-map)
 * and adding a TabMeta entry here.
 */
export type TabMeta = {
  id: MobileSurface;
  label: string;
  iconKey: "map" | "pin" | "survey" | "chat" | "more" | "report";
};

export const TABS: Record<MobileSurface, TabMeta | null> = {
  map:       { id: "map",     label: "Map",     iconKey: "map" },
  points:    { id: "points",  label: "Points",  iconKey: "pin" },
  survey:    { id: "survey",  label: "Survey",  iconKey: "survey" },
  chat:      { id: "chat",    label: "Chat",    iconKey: "chat" },
  more:      { id: "more",    label: "More",    iconKey: "more" },
  report:    { id: "report",  label: "Report",  iconKey: "report" },
  // these are reachable via the More menu / inner navigation, not tabs:
  analysis:  null,
  members:   null,
  settings:  null,
  import:    null,
  reports:   null,
  add:       null,
};

/**
 * Which tabs are visible per role. Order matters — left to right on the bar.
 * Guest only sees Map/Chat/Report; Member skips the More slot; Admin gets all 5.
 */
export const TABS_BY_ROLE: Record<ProjectRole, MobileSurface[]> = {
  admin:  ["map", "points", "survey", "chat", "more"],
  member: ["map", "points", "survey", "chat"],
  guest:  ["map", "chat", "report"],
};

/**
 * Which surfaces a role is allowed to render. Superset of TABS_BY_ROLE
 * because the More menu opens routes like /m/members that are not on the
 * tab bar. Used by the (mobile)/layout role-gate.
 */
export const SURFACES_BY_ROLE: Record<ProjectRole, Set<MobileSurface>> = {
  admin: new Set([
    "map", "points", "survey", "chat", "more",
    "analysis", "members", "settings", "import", "reports", "add",
  ]),
  member: new Set(["map", "points", "survey", "chat", "add"]),
  guest:  new Set(["map", "chat", "report", "add"]),
};

/** Pretty label used in the topbar pill ("Admin" / "Member" / "Guest"). */
export const ROLE_LABEL: Record<ProjectRole, string> = {
  admin: "Admin",
  member: "Member",
  guest: "Guest",
};

/** Tone color for the role pill — matches the spec palette. */
export const ROLE_COLOR: Record<ProjectRole, string> = {
  admin: "var(--m-accent)",
  member: "#10b981",
  guest: "#f59e0b",
};

export function isSurfaceAllowed(role: ProjectRole, surface: MobileSurface): boolean {
  return SURFACES_BY_ROLE[role].has(surface);
}

export function tabsForRole(role: ProjectRole): TabMeta[] {
  return TABS_BY_ROLE[role]
    .map((s) => TABS[s])
    .filter((t): t is TabMeta => t !== null);
}
