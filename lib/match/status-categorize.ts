/**
 * Canvassing-status normalizer — mirrors Keystone's STATUS_MAP /
 * STATUS_COLORS (KeyStone_project/app.py:88, keystone_field_api/main.py:100).
 *
 * Real canvassing logs use free-form text in the status column. Without
 * normalization, "Gated, inaccessible; left flier" and "Kathryn Martin;
 * survey; ID# 8081" each get their own marker color and the map turns
 * into noise. Keystone collapses everything into 8 canonical buckets
 * via case-insensitive substring matching against the row text.
 *
 * Rule order matters: the FIRST matching rule wins. We bias toward the
 * most specific signal in mixed-text rows ("gated, inaccessible; left
 * flier" should categorize as Inaccessible — the gate is the binding
 * constraint, the flier is just what the surveyor did after).
 */

export const CANONICAL_STATUS_COLORS = {
  Completed: "#10b981",      // emerald — surveyed
  "No Answer": "#f97316",    // orange — nobody home / not now
  Inaccessible: "#ef4444",   // red — gate, fence, dog, locked
  "Not Interested": "#8b5cf6", // violet — refused / declined
  "Left Info": "#3b82f6",    // blue — dropped flyer / QR
  Vacant: "#6b7280",         // gray — empty / abandoned
  "Follow Up": "#06b6d4",    // cyan — try again later
  Other: "#ec4899",          // pink — categorized but not in main 7
  Unknown: "#9ca3af",        // light gray — empty status text
} as const;

export type CanonicalStatus = keyof typeof CANONICAL_STATUS_COLORS;

/**
 * Ordered substring rules. Most specific signal first.
 * Extended beyond Keystone's defaults to catch patterns from real
 * canvassing CSVs (e.g. "Kathryn Martin; survey; ID# 8081" → Completed,
 * "No time today; gave flier/QR code" → No Answer, since "no time"
 * dominates "flier" — door was attempted, respondent unavailable).
 */
const RULES: Array<[needle: string, status: CanonicalStatus]> = [
  // Inaccessible signals must beat Left-Info in mixed text:
  // "Gated, inaccessible; left flier" → Inaccessible.
  ["inaccessible", "Inaccessible"],
  ["gated", "Inaccessible"],
  ["no access", "Inaccessible"],
  ["locked", "Inaccessible"],
  ["fence", "Inaccessible"],
  ["dog", "Inaccessible"],
  // No-Answer signals must also beat Left-Info: dropping a flier when
  // nobody answered still means "no answer".
  ["no answer", "No Answer"],
  ["no ans", "No Answer"],
  ["no one home", "No Answer"],
  ["not home", "No Answer"],
  ["no time", "No Answer"],
  ["away", "No Answer"],
  ["busy", "No Answer"],
  // Completed signals
  ["completed", "Completed"],
  ["interviewed", "Completed"],
  ["survey;", "Completed"],
  ["survey ", "Completed"],
  ["survey,", "Completed"],
  ["id#", "Completed"],
  ["id #", "Completed"],
  ["responded", "Completed"],
  // Not Interested
  ["not interested", "Not Interested"],
  ["refused", "Not Interested"],
  ["declined", "Not Interested"],
  // Left Info (after the higher-priority categories above)
  ["left info", "Left Info"],
  ["left flyer", "Left Info"],
  ["left flier", "Left Info"],
  ["flyer", "Left Info"],
  ["flier", "Left Info"],
  ["qr", "Left Info"],
  // Vacant
  ["vacant", "Vacant"],
  ["empty", "Vacant"],
  ["abandoned", "Vacant"],
  ["unoccupied", "Vacant"],
  // Follow Up
  ["follow up", "Follow Up"],
  ["follow-up", "Follow Up"],
  ["callback", "Follow Up"],
  ["call back", "Follow Up"],
  ["come back", "Follow Up"],
  // Other (explicit only)
  ["other", "Other"],
];

export function categorizeStatus(label: string | null | undefined): CanonicalStatus {
  const t = (label ?? "").trim().toLowerCase();
  if (!t) return "Unknown";
  for (const [needle, status] of RULES) {
    if (t.includes(needle)) return status;
  }
  return "Unknown";
}

export function colorForStatusLabel(
  label: string | null | undefined,
  // Optional project_statuses override — if the user has typed a status
  // whose label matches one we'd assign, prefer their color so the map
  // stays consistent with their left-rail palette.
  projectStatuses?: Array<{ label: string; color: string }> | null,
): string {
  const cat = categorizeStatus(label);
  if (projectStatuses) {
    const target = cat.toLowerCase();
    for (const s of projectStatuses) {
      if (s.label.toLowerCase() === target) return s.color;
    }
  }
  return CANONICAL_STATUS_COLORS[cat];
}
