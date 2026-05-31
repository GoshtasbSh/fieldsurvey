// FieldSurvey Analyses Catalog — typed contract.
// See docs/superpowers/specs/2026-05-29-analyses-catalog-design.md

export type CardSection =
  | "cornerstone"
  | "response"
  | "spatial"
  | "coverage"
  | "temporal"
  | "qc"
  | "quality"
  | "bias"
  | "compare"
  | "inference"
  | "actions";

export type ComputeStrategy = "postgres" | "python_sidecar" | "client";

export type RoleGate = "admin" | "member" | "guest" | "surveyor";

/** Inputs the card needs to even be eligible. Catalog disables ineligible cards. */
export type RequiredInput =
  | "points"
  | "responses"
  | "raw_data_key_categorical"
  | "raw_data_key_numeric"
  | "raw_data_key_multi"
  | "raw_data_key_text"
  | "statuses"
  | "aapor_mapping"
  | "universe"
  | "boundary"
  | "parcels"
  | "demographics_schema"
  | "acs_tract_profile"
  | "cdc_svi_tract"
  | "cdc_places_tract"
  | "photos"
  | "shifts"
  | "geocode_metadata"
  | "match_status"
  | "project_tz"
  | "timestamps_n_days";

export type CardDescriptor = {
  /** Stable string id used everywhere (DB, registry, votes, URL). */
  id: string;
  section: CardSection;
  name: string;
  /** One-sentence "what it answers" — shown in Catalog drawer. */
  short: string;
  requiredInputs: RequiredInput[];
  /** Minimum n to render the card body; below this, n_min PlaceholderPanel renders. */
  nMin: number;
  /** Minimum role to see the card. */
  roleGate: RoleGate;
  /** Always false for Analyze cards — mobile is field-only. */
  mobileVisible: boolean;
  computeStrategy: ComputeStrategy;
  /** String key referencing a lazy-loaded React component in the viz registry. */
  vizComponent: string;
  /** Whether this card is in the research-backed Default pack. */
  defaultPack: boolean;
  /** Whether M7 implements this card (built, not stub). */
  m7Wave1: boolean;
  /** True = renders as "Coming" placeholder in Catalog. */
  stub: boolean;
  /** Trust-chrome keys the card must render in its header. */
  trustSignals: string[];
  /** Plain-language pitfalls — rendered in "Why this card" expandable. */
  pitfalls: string[];
  /** Inspiration / source — rendered in method link. */
  sourceInspiration?: string;
  /** Stable sort order within section. */
  cardOrder: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// A0 cornerstone — Question colorizer types
// ─────────────────────────────────────────────────────────────────────────────

export type InferredColumnType =
  | "categorical"
  | "likert"
  | "numeric_continuous"
  | "numeric_skewed"
  | "date"
  | "text_open"
  | "boolean"
  | "missing";

export type ClassificationMethod =
  | "quantile"
  | "equal_interval"
  | "natural_breaks"
  | "manual";

export type ColorRamp =
  | "viridis"
  | "inferno"
  | "plasma"
  | "cividis"
  | "magma"
  | "RdBu_r"
  | "BrBG"
  | "Set2"
  | "Set3"
  | "Dark2";

/** Stored in user_view_state.colorize_spec and project_saved_views.colorize_spec. */
export type ColorizeSpec = {
  /** The raw_data key (or 'match_status' for the default behavior). */
  columnKey: string;
  inferredType: InferredColumnType;
  classification: ClassificationMethod;
  classCount: 3 | 5 | 7 | 9;
  ramp: ColorRamp;
  /** When classification === 'manual', explicit breakpoints. */
  manualBreaks?: number[];
  /** Optional override: reverse the ramp direction. */
  reversed?: boolean;
};

/** Per-column profile written at import time and read by the colorizer. */
export type ColumnProfile = {
  key: string;
  inferredType: InferredColumnType;
  nNonNull: number;
  distinct: number;
  /** Only set for numeric. */
  min?: number;
  max?: number;
  median?: number;
  skewness?: number;
  /** Up to 12 sample values, for legend preview. */
  sampleValues: string[];
  /** Detected when type is likert; ordered low→high. */
  likertOrder?: string[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Spatial Analysis Toolbox (Wave 0)
// ─────────────────────────────────────────────────────────────────────────────

export type ToolboxSlug =
  // v1
  | "symbology"
  | "analyzing_patterns"
  | "mapping_clusters"
  | "spatial_relationships"
  | "coverage_equity"
  // v2 placeholders
  | "space_time"
  | "spatial_regression"
  | "sampling_equity";

export type PreviewImage = {
  /** Absolute path under public/, e.g. "/analyses-previews/S2_gi_star_q.jpg". */
  src: string;
  /** Screen-reader description. */
  alt: string;
  /** Attribution link. */
  sourceUrl: string;
  /** Human-readable source name. */
  sourceTitle: string;
  /** SPDX-ish license string, e.g. "CC-BY-4.0", "Public Domain". */
  license: string;
};

export type SettingSchema =
  | { key: string; type: "question_picker"; label: string; defaultValue?: "inherit_global" | string }
  | { key: string; type: "answer_picker"; label: string; questionKeyRef: string; defaultValue?: string }
  | { key: string; type: "poi_picker"; label: string; defaultValue?: { lat: number; lon: number } | null }
  | { key: string; type: "slider"; label: string; min: number; max: number; step: number; defaultValue: number }
  | { key: string; type: "select"; label: string; options: Array<{ value: string | number; label: string }>; defaultValue: string | number }
  | { key: string; type: "toggle"; label: string; defaultValue: boolean };

export type SpatialCardCatalogEntry = CardDescriptor & {
  toolbox: ToolboxSlug;
  previewImage: PreviewImage;
  questionsAnswered: string[];
  whatItDoes: string;
  inputRequirements: string[];
  settingsSchema: SettingSchema[];
};

export type AnalysisListItem = {
  cardId: string;
  settings: Record<string, unknown>;
  addedAt: string; // ISO timestamp
};
