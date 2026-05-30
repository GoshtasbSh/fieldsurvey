export type AaporCounts = {
  I: number; P: number; R: number;
  NC: number; O: number; UH: number; UO: number;
};

export type AaporRates = {
  rr1: number | null;
  rr3: number | null;
  rr5: number | null;
  coop1: number | null;
  ref1: number | null;
  con1: number | null;
  e: number;
};

function estimateEligibility(c: AaporCounts): number {
  const known = c.I + c.P + c.R + c.NC + c.O;
  return known === 0 ? 0 : 1.0; // all known cases are eligible by definition
}

export function computeAaporRates(c: AaporCounts): AaporRates {
  const denom1 = c.I + c.P + c.R + c.NC + c.O + c.UH + c.UO;
  if (denom1 === 0) {
    return { rr1: null, rr3: null, rr5: null, coop1: null, ref1: null, con1: null, e: 0 };
  }
  const e = estimateEligibility(c);
  const denom3 = c.I + c.P + c.R + c.NC + c.O + e * (c.UH + c.UO);
  const denom5 = c.I + c.P + c.R + c.NC + c.O;
  const coop1Denom = c.I + c.P + c.R;
  const ref1Denom = c.I + c.P + c.R + c.NC + c.O;
  const con1Num = c.I + c.P + c.R + c.O;
  return {
    rr1: c.I / denom1,
    rr3: denom3 > 0 ? c.I / denom3 : null,
    rr5: denom5 > 0 ? c.I / denom5 : null,
    coop1: coop1Denom > 0 ? c.I / coop1Denom : null,
    ref1: ref1Denom > 0 ? c.R / ref1Denom : null,
    con1: con1Num / denom1,
    e,
  };
}
