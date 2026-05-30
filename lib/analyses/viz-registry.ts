import { lazy, type ComponentType, type LazyExoticComponent } from "react";

// Cards may accept additional optional props (e.g. cached data passed by a
// future dispatcher); the registry contract only guarantees `projectId` +
// optional `userRole` from `<RegistryCard>`. Widen to Record<string, unknown>
// so each card declares its own prop shape without TS narrowing failures.
export type CardComponent = LazyExoticComponent<ComponentType<Record<string, unknown>>>;

export const VIZ_REGISTRY: Record<string, CardComponent> = {
  FreshnessChip:         lazy(() => import("@/components/analyses/cards/a39-freshness").then(m => ({ default: m.FreshnessChip }))),
  // TODO: M7 wave-1 tasks 8-32 — restore as each card lands.
  MatchDonut:            lazy(() => import("@/components/analyses/cards/match-donut").then(m => ({ default: m.MatchDonut }))),
  AaporRatesPanel:       lazy(() => import("@/components/analyses/cards/a16-17-18-aapor").then(m => ({ default: m.AaporRatesPanel }))),
  AaporCoopRefPanel:     lazy(() => import("@/components/analyses/cards/a16-17-18-aapor").then(m => ({ default: m.AaporCoopRefPanel }))),
  AaporContactTile:      lazy(() => import("@/components/analyses/cards/a16-17-18-aapor").then(m => ({ default: m.AaporContactTile }))),
  HourHistogram:         lazy(() => import("@/components/analyses/cards/a23-hour-local").then(m => ({ default: m.HourHistogram }))),
  DowHourHeatmap:        lazy(() => import("@/components/analyses/cards/a24-dow-heatmap").then(m => ({ default: m.DowHourHeatmap }))),
  VelocityLineCI:        lazy(() => import("@/components/analyses/cards/a25-velocity").then(m => ({ default: m.VelocityLineCI }))),
  MonteCarloFan:         lazy(() => import("@/components/analyses/cards/a21-finish-fan").then(m => ({ default: m.MonteCarloFan }))),
  ProductivityBullet:    lazy(() => import("@/components/analyses/cards/a28-productivity").then(m => ({ default: m.ProductivityBullet }))),
  TopKBlocks:            lazy(() => import("@/components/analyses/cards/a51-topk-blocks").then(m => ({ default: m.TopKBlocks }))),
  DivergingBar:          lazy(() => import("@/components/analyses/cards/a01-univariate").then(m => ({ default: m.DivergingBar }))),
  HistogramBoxplot:      lazy(() => import("@/components/analyses/cards/a02-numeric-summary").then(m => ({ default: m.HistogramBoxplot }))),
  UpSetPlot:             lazy(() => import("@/components/analyses/cards/a03-upset").then(m => ({ default: m.UpSetPlot }))),
  SignificanceChoropleth:lazy(() => import("@/components/analyses/cards/a08-gi-star").then(m => ({ default: m.SignificanceChoropleth }))),
  // LisaMap handled by RegistryCard stub branch — A9 registry entry has stub:true
  KdeRaster:             lazy(() => import("@/components/analyses/cards/a11-kde").then(m => ({ default: m.KdeRaster }))),
  RateChoropleth:        lazy(() => import("@/components/analyses/cards/a13-cov-heatmap").then(m => ({ default: m.RateChoropleth }))),
  UniverseMap:           lazy(() => import("@/components/analyses/cards/a19-universe-map").then(m => ({ default: m.UniverseMap }))),
  RankedBullet:          lazy(() => import("@/components/analyses/cards/a20-undersampled").then(m => ({ default: m.RankedBullet }))),
  RefusalSmallMultiples: lazy(() => import("@/components/analyses/cards/a22-refusal-pattern").then(m => ({ default: m.RefusalSmallMultiples }))),
  GpsOutlierBox:         lazy(() => import("@/components/analyses/cards/a29-gps-outlier").then(m => ({ default: m.GpsOutlierBox }))),
  OffBoundaryMapList:    lazy(() => import("@/components/analyses/cards/a33-off-boundary").then(m => ({ default: m.OffBoundaryMapList }))),
  SampleVsAcsBars:       lazy(() => import("@/components/analyses/cards/a40-sample-vs-acs").then(m => ({ default: m.SampleVsAcsBars }))),
  F1QueueListMap:        lazy(() => import("@/components/analyses/cards/a52-f1-queue").then(m => ({ default: m.F1QueueListMap }))),
};

export function getVizComponent(name: string): CardComponent | null {
  return VIZ_REGISTRY[name] ?? null;
}
