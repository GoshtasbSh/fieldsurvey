// FieldSurvey spatial-analysis toolbox metadata.
// Drives the left rail of the Add-Analysis modal (see components/analyses/toolbox-left-rail.tsx).

import type { ToolboxSlug } from "./types";

export type Toolbox = {
  slug: ToolboxSlug;
  label: string;
  icon: string;         // emoji or single-glyph; rendered in left rail
  description: string;  // shown under the cards-grid header when toolbox is selected
  isV2: boolean;
  sortOrder: number;
};

export const TOOLBOXES: Toolbox[] = [
  {
    slug: "symbology",
    label: "Symbology & Visualization",
    icon: "🎨",
    description: "Color your map points by any survey response.",
    isV2: false,
    sortOrder: 10,
  },
  {
    slug: "analyzing_patterns",
    label: "Analyzing Patterns",
    icon: "📊",
    description: "Global statistics — is the answer spatially clustered at all?",
    isV2: false,
    sortOrder: 20,
  },
  {
    slug: "mapping_clusters",
    label: "Mapping Clusters",
    icon: "🔥",
    description: "Local statistics — pinpoint clusters, spatial outliers, and concentration zones.",
    isV2: false,
    sortOrder: 30,
  },
  {
    slug: "spatial_relationships",
    label: "Modeling Spatial Relationships",
    icon: "📐",
    description: "Distance, proximity, and multi-question spatial patterns.",
    isV2: false,
    sortOrder: 40,
  },
  {
    slug: "coverage_equity",
    label: "Survey Coverage & Equity",
    icon: "📋",
    description: "Did we BOTH cover the universe AND get representative answers?",
    isV2: false,
    sortOrder: 50,
  },
  {
    slug: "survey_response",
    label: "Survey Response",
    icon: "📊",
    description: "Aggregate and cross-tabulate survey response distributions across the project.",
    isV2: false,
    sortOrder: 55,
  },
  {
    slug: "quality_bias",
    label: "Quality & Bias",
    icon: "🔍",
    description: "Detect data-quality issues, interviewer effects, and potential response bias.",
    isV2: false,
    sortOrder: 58,
  },
  {
    slug: "space_time",
    label: "Space-Time Pattern Mining",
    icon: "⏰",
    description: "Temporal Gi* + Mann-Kendall — where are response patterns emerging or fading over time?",
    isV2: false,
    sortOrder: 60,
  },
  {
    slug: "spatial_regression",
    label: "Spatial Regression",
    icon: "📈",
    description: "OLS baseline, Moran residual test, Spatial Lag (2SLS), and Spatial Error (FGLS) with AIC comparison.",
    isV2: false,
    sortOrder: 70,
  },
  {
    slug: "sampling_equity",
    label: "Sampling Equity",
    icon: "⚖️",
    description: "Dissimilarity D, Isolation P*, Entropy H, Gini — five established segregation indices by response group.",
    isV2: false,
    sortOrder: 80,
  },
];

export function v1Toolboxes(): Toolbox[] {
  return TOOLBOXES.filter(t => !t.isV2).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function v2Toolboxes(): Toolbox[] {
  return TOOLBOXES.filter(t => t.isV2).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function getToolbox(slug: ToolboxSlug): Toolbox | undefined {
  return TOOLBOXES.find(t => t.slug === slug);
}
