export type AaporCounts = {
  I: number; P: number; R: number;
  NC: number; O: number; UH: number; UO: number;
  /**
   * Points whose status_id has no entry in project_aapor_mapping. These are
   * EXCLUDED from every AAPOR rate denominator (treated as if they don't
   * exist for rate-computation purposes). The count is surfaced separately
   * via AaporRates.unmappedCount so the UI can warn the admin.
   */
  UNMAPPED?: number;
};

export type AaporRates = {
  rr1: number | null;
  rr3: number | null;
  rr5: number | null;
  coop1: number | null;
  ref1: number | null;
  con1: number | null;
  e: number;
  /** Number of points with no AAPOR mapping (excluded from all denominators). */
  unmappedCount: number;
};

function estimateEligibility(c: AaporCounts): number {
  // CASRO-style: among cases of known status, what proportion are eligible?
  // Eligible-known = I + P + R + NC (people we could/should have surveyed).
  // Ineligible-known = O (other, treated here as ineligible by convention).
  const eligibleKnown = c.I + c.P + c.R + c.NC;
  const known = eligibleKnown + c.O;
  return known === 0 ? 1 : eligibleKnown / known;
}

export function computeAaporRates(c: AaporCounts): AaporRates {
  // UNMAPPED points are excluded from every denominator — we mathematically
  // pretend they don't exist. The count is surfaced on the returned object
  // so the UI can warn the admin to finish their AAPOR mapping.
  const unmappedCount = c.UNMAPPED ?? 0;
  const denom1 = c.I + c.P + c.R + c.NC + c.O + c.UH + c.UO;
  if (denom1 === 0) {
    return {
      rr1: null, rr3: null, rr5: null, coop1: null, ref1: null, con1: null,
      e: 0, unmappedCount,
    };
  }
  const e = estimateEligibility(c);
  const denom3 = c.I + c.P + c.R + c.NC + c.O + e * (c.UH + c.UO);
  const denom5 = c.I + c.P + c.R + c.NC + c.O;
  const coop1Denom = c.I + c.P + c.R;
  const ref1Denom = denom1;
  const con1Num = c.I + c.P + c.R + c.O;
  return {
    rr1: c.I / denom1,
    rr3: denom3 > 0 ? c.I / denom3 : null,
    rr5: denom5 > 0 ? c.I / denom5 : null,
    coop1: coop1Denom > 0 ? c.I / coop1Denom : null,
    ref1: ref1Denom > 0 ? c.R / ref1Denom : null,
    con1: con1Num / denom1,
    e,
    unmappedCount,
  };
}
