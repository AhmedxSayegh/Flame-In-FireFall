// ─── Input schema (shared/schemas/input.schema.json) ──────────────────────
export const CREW_ENVIRONMENTS = ['All Environments', 'Spacecraft', 'Space Station', 'Lunar Base', 'Martian Base', 'Pressurized Rover'] as const;
export const FIRE_SAFETY_CATEGORIES = ['All Categories', 'Fire Prevention', 'Fire Detection', 'Fire Growth & Spread', 'Fire Suppression'] as const;
export const RESEARCH_TOPICS = ['All Topics', 'Material Flammability', 'Flame Spread', 'Smoke & Aerosols', 'Flame Extinction', 'Combustion Behavior'] as const;
export const INVESTIGATIONS = ['All Investigations', 'BASS', 'BASS-II', 'Saffire-I', 'Saffire-II', 'Saffire-III', 'SAME', 'SAME-R', 'FLEX', 'FLEX-2', 'ACME'] as const;
export const FUEL_TYPES = ['All', 'Solid Materials', 'Liquid Fuels', 'Gaseous Fuels'] as const;
export const MEASUREMENT_TYPES = ['All Measurements', 'Flame Spread Rate', 'Flame Size', 'Burning Rate', 'Extinction Conditions', 'Smoke Particle Size', 'Detector Response'] as const;
export const GRAVITY_LEVELS = ['All', 'microgravity', 'partial gravity', 'normal gravity'] as const;

export type CrewEnvironment = (typeof CREW_ENVIRONMENTS)[number];
export type FireSafetyCategory = (typeof FIRE_SAFETY_CATEGORIES)[number];
export type ResearchTopic = (typeof RESEARCH_TOPICS)[number];
export type Investigation = (typeof INVESTIGATIONS)[number];
export type FuelType = (typeof FUEL_TYPES)[number];
export type MeasurementType = (typeof MEASUREMENT_TYPES)[number];
export type InputGravity = (typeof GRAVITY_LEVELS)[number] | null;

export interface InputConditions {
  oxygen_pct?: number | null;
  pressure_kpa?: number | null;
  airflow_cm_s?: number | null;
  gravity_level?: InputGravity;
}

/** Exactly the shape of input.schema.json (additionalProperties: false). */
export interface SearchInput {
  crew_environment: CrewEnvironment;
  fire_safety_category: FireSafetyCategory;
  research_topic: ResearchTopic;
  investigation: Investigation;
  fuel_type: FuelType;
  measurement_type: MeasurementType;
  conditions?: InputConditions;
}

/** The free-text question is NOT in the strict input schema, so it travels separately. */
export interface SearchRequest {
  input: SearchInput;
  research_question: string | null;
}

// ─── Output schema (shared/schemas/output.schema.json) ────────────────────
// The backend copies the user's input into output.query unchanged.
export type Gravity = 'microgravity' | 'partial gravity' | 'normal gravity' | 'simulated microgravity';

/** "match" | "partial" | "no match" | "unknown", optionally " (reason)". */
export type MatchString = string;
export type MatchLevel = 'match' | 'partial' | 'no match' | 'unknown';

export const FIELD_MATCH_KEYS = [
  'crew_environment', 'fire_safety_category', 'research_topic', 'investigation', 'fuel_type',
  'measurement_type', 'oxygen', 'pressure', 'airflow', 'gravity',
] as const;
export type FieldMatchKey = (typeof FIELD_MATCH_KEYS)[number];

/** Labels shown for field_matches keys. */
export const FIELD_LABEL: Record<FieldMatchKey, string> = {
  crew_environment: 'Crew environment', fire_safety_category: 'Fire safety category', research_topic: 'Research topic',
  investigation: 'Investigation', fuel_type: 'Fuel type', measurement_type: 'Measurement', oxygen: 'Oxygen',
  pressure: 'Pressure', airflow: 'Airflow', gravity: 'Gravity',
};
export type FieldMatches = Partial<Record<FieldMatchKey, MatchString>>;

export interface TestRef { test_number: number | string; test_identifier: string }

export interface TopExperiment {
  rank: number;
  experiment_id: string;
  tests: TestRef[];
  experiment: string;
  why_selected?: string;
  summary_of_key_findings: string;
  fire_safety_interpretation: string;
  evidence: string[];
}

export interface ComparedRow { attribute: string; values: Record<string, string> }

export interface TopExperimentsComparison {
  experiment_ids: string[];
  compared_on: ComparedRow[];
  similarities: string[];
  differences: string[];
  conclusion: string;
}

export interface RankedInvestigation {
  psi_id: string;
  name: string;
  reference_link: string;
  rank: number;
  relevance_score: number;
  score_method?: string;
  field_matches: FieldMatches;
  top_experiments: TopExperiment[];
  runner_up?: string | null;
  top_experiments_comparison: TopExperimentsComparison;
}

export interface SearchOutput {
  query: SearchInput;
  inputs_used: string[];
  lunar_reference?: string;
  match_quality: string;
  ranked: RankedInvestigation[];
  overall_insights: string[];
  gaps: string[];
  caveats: string[];
}

// ─── Experiment records (chart / source layer) ─────────────────────────────
// The output schema carries formatted strings only. Charts need numbers, so they read
// these records, keyed by experiment_id, from GET /api/records
// (built by backend/pipeline.py experiment_records()).

export type Quantity = 'burning_rate' | 'flame_spread_rate' | 'flame_size' | 'extinction_condition' | 'smoke_particle_size' | 'detector_response';

export const QUANTITY_LABEL: Record<Quantity, string> = {
  burning_rate: 'Burning rate',
  flame_spread_rate: 'Flame spread rate',
  flame_size: 'Flame size',
  extinction_condition: 'Extinction condition',
  smoke_particle_size: 'Smoke particle size',
  detector_response: 'Detector response',
};

export interface Measurement {
  quantity: Quantity;
  value: number;
  unit: string;
  /** Exact definition, e.g. "droplet burning-rate constant K (d²-law)". Only identical definition+unit are plotted together. */
  definition: string;
  source?: string;
}

export interface TestRecord {
  test_number: number | string;
  test_identifier: string;
  oxygen_pct: number | null;
  pressure_kpa: number | null;
  airflow_cm_s: number | null;
  /** As recorded in the source (e.g. "Extinguished", "Burned to completion"). */
  outcome: string | null;
  measurements: Measurement[];
}

export interface SourceRef {
  label: string;
  url?: string;
  kind: 'dataset' | 'report' | 'paper' | 'page';
  authors?: string;
  year?: number;
  pages?: string;
  /** Only verified publications are shown as "verified". */
  verified: boolean;
}

export interface ExperimentRecord {
  experiment_id: string;
  psi_id: string;
  investigation: string;
  label: string;
  fuel: string | null;
  fuel_type: Exclude<FuelType, 'All'> | null;
  sample: string | null;
  gravity: Gravity | null;
  tests: TestRecord[];
  sources: SourceRef[];
}

// ─── Backend response (backend/app.py, POST /api/search) ──────────────────
/** How the result was produced. "saved_example" = no API key set; the backend returned its saved example. */
export interface RunMeta {
  mode: 'live' | 'saved_example';
  model: string | null;
  run_id: string;
  duration_s: number;
  valid: boolean;
  validation_errors: string[];
  /** Fields the backend corrected after Gemini answered (links, test lists). */
  integrity_notes: string[];
  query_matches_example?: boolean;
  log?: string[];
}

export interface SearchResponse { output: SearchOutput; meta: RunMeta }

/** GET /api/status */
export interface BackendStatus {
  mode: 'live' | 'saved_example';
  model: string | null;
  investigations: { psi_id: string; acronym?: string; title?: string; experiments: number; reports: { name: string; mb: number }[] }[];
}
