/**
 * FieldSurvey match-status (M1/F1/R1) — generalized from Keystone's
 * G1/G2/G3 system (see `legacy-keystone-snapshot` git tag, file
 * static/js/dashboard.js around the addLayers() and updateMatchStatusPanel
 * functions). DO NOT change the semantics — they are user-authoritative.
 *
 * Semantics (memorized in project_fieldsurvey_match_status.md):
 *   M1 matched       — Completed field point + survey response linked
 *   F1 field only    — Completed field point, NO response could be matched
 *                      (the surveyor reported a visit, the response is missing
 *                       or didn't match — needs attention to chase)
 *   R1 response only — A survey response with no field point at that location
 *                      (came in via flyer / online form / QR — tells the
 *                       team "don't bother visiting, they already responded")
 *
 * Symbology (DO NOT change, matches Keystone exactly):
 *   M1: white stroke 1.5px, color #ffffff
 *   F1: bright pure yellow stroke 2.8px, color #fde047 (NOT amber — too
 *       close to No-Answer #f97316 in the status palette)
 *   R1: house-with-scanlines glyph + purple halo
 */

export type MatchStatus = "M1" | "F1" | "R1";

export const MATCH_LABEL: Record<MatchStatus, string> = {
  M1: "Matched",
  F1: "Field only",
  R1: "Response only",
};

export const MATCH_DESCRIPTION: Record<MatchStatus, string> = {
  M1: "Field point + survey response linked",
  F1: "Collected but no matching response",
  R1: "Response in, no field visit yet",
};

export const MATCH_ACTION: Record<MatchStatus, string> = {
  M1: "Complete",
  F1: "Chase response",
  R1: "Send surveyor",
};

/** Keystone-faithful stroke specification for MapLibre circle layers. */
export const MATCH_RING = {
  M1: { color: "#ffffff", width: 1.5 },
  F1: { color: "#fde047", width: 2.8 },
  R1: { color: "#a855f7", width: 2.5 },
} as const;

/** Used for the left-rail badge backgrounds (OKLCH for tinted neutrals). */
export const MATCH_BG = {
  M1: "oklch(96% 0.008 250 / 0.14)",
  F1: "oklch(86% 0.18 88 / 0.16)",
  R1: "oklch(72% 0.18 305 / 0.16)",
} as const;

export type MatchStatusCounts = {
  m1_count: number;
  f1_count: number;
  r1_count: number;
  total_with_status: number;
};

export type MatchStatusRow = {
  point_id: string | null;
  response_id: string | null;
  project_id: string;
  status_id: string | null;
  status_label: string | null;
  lat: number;
  lon: number;
  is_matched: boolean;
  match_status: MatchStatus | null;
};
