"use client";

// Client hook wiring the A0 question colorizer: fetches column profiles,
// fetches values when a column is selected, builds derived feature colors.
//
// Usage (in map-shell.tsx):
//   const colorizer = useColorizer(projectId, features);
//   <ColorizerControl
//     profiles={colorizer.profiles}
//     selectedValues={colorizer.selectedNumericValues}
//     spec={colorizer.spec}
//     onChange={colorizer.setSpec}
//   />
//   <MaplibreMap ... featureColors={colorizer.featureColors} />

import { useEffect, useMemo, useState } from "react";
import type { ColorizeSpec, ColumnProfile } from "@/lib/analyses/types";
import type { MatchStatusRow } from "@/lib/match/status";
import { deriveFeatureColors } from "./derive-feature-colors";

export function useColorizer(projectId: string, features: MatchStatusRow[]) {
  const [profiles, setProfiles] = useState<ColumnProfile[]>([]);
  const [profilesLoaded, setProfilesLoaded] = useState(false);
  const [spec, setSpec] = useState<ColorizeSpec | null>(null);
  const [currentProfile, setCurrentProfile] = useState<ColumnProfile | null>(null);
  const [valuesByResponseId, setValuesByResponseId] = useState<Record<string, unknown>>({});

  // Lazy-fetch the column profile list once.
  useEffect(() => {
    let alive = true;
    fetch(`/api/projects/${projectId}/columns`)
      .then((r) => r.json())
      .then((r) => {
        if (!alive) return;
        setProfiles(r.profiles ?? []);
        setProfilesLoaded(true);
      })
      .catch(() => alive && setProfilesLoaded(true));
    return () => { alive = false; };
  }, [projectId]);

  // When the user picks a column, fetch its values.
  useEffect(() => {
    if (!spec || spec.columnKey === "match_status") {
      setCurrentProfile(null);
      setValuesByResponseId({});
      return;
    }
    let alive = true;
    fetch(`/api/projects/${projectId}/columns/${encodeURIComponent(spec.columnKey)}`)
      .then((r) => r.json())
      .then((r) => {
        if (!alive) return;
        setCurrentProfile(r.profile ?? null);
        setValuesByResponseId(r.valuesByResponseId ?? {});
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [projectId, spec?.columnKey]);

  const selectedNumericValues = useMemo<number[]>(() => {
    if (!spec) return [];
    if (spec.inferredType !== "numeric_continuous" && spec.inferredType !== "numeric_skewed") return [];
    return Object.values(valuesByResponseId)
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n));
  }, [spec, valuesByResponseId]);

  const featureColors = useMemo(
    () =>
      deriveFeatureColors({
        features,
        valuesByResponseId,
        profile: currentProfile,
        spec,
      }),
    [features, valuesByResponseId, currentProfile, spec],
  );

  return {
    profiles,
    profilesLoaded,
    spec,
    setSpec,
    selectedNumericValues,
    featureColors,
  };
}
