import type { ExperimentRecord } from '../types';

/**
 * Checks one record from GET /api/records and keeps only well-formed values.
 * The backend (pipeline.py experiment_records) already returns ExperimentRecord-shaped
 * objects; if you rename fields there, update this function to match.
 */
export function adaptBackendRecord(raw: unknown): ExperimentRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<ExperimentRecord>;
  if (!r.experiment_id || !r.psi_id || !Array.isArray(r.tests)) return null;
  return {
    experiment_id: r.experiment_id,
    psi_id: r.psi_id,
    investigation: r.investigation ?? r.psi_id,
    label: r.label ?? r.experiment_id,
    fuel: r.fuel ?? null,
    fuel_type: r.fuel_type ?? null,
    sample: r.sample ?? null,
    gravity: r.gravity ?? null,
    sources: Array.isArray(r.sources) ? r.sources : [],
    // Keep only numerically valid measurements; never coerce strings into numbers.
    tests: r.tests.map((t) => ({
      ...t,
      oxygen_pct: typeof t.oxygen_pct === 'number' ? t.oxygen_pct : null,
      pressure_kpa: typeof t.pressure_kpa === 'number' ? t.pressure_kpa : null,
      airflow_cm_s: typeof t.airflow_cm_s === 'number' ? t.airflow_cm_s : null,
      outcome: t.outcome ?? null,
      measurements: (t.measurements ?? []).filter((m) => typeof m.value === 'number' && Number.isFinite(m.value) && !!m.unit && !!m.definition),
    })),
  };
}
