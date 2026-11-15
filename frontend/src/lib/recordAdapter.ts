import { QUANTITY_LABEL, type ExperimentRecord } from '../types';

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

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
    tests: r.tests.filter((t) => t && typeof t.test_identifier === 'string').map((t) => ({
      ...t,
      oxygen_pct: finite(t.oxygen_pct),
      pressure_kpa: finite(t.pressure_kpa),
      airflow_cm_s: finite(t.airflow_cm_s),
      outcome: t.outcome ?? null,
      measurements: (Array.isArray(t.measurements) ? t.measurements : []).filter((m) => m && finite(m.value) != null && Object.hasOwn(QUANTITY_LABEL, m.quantity) && !!m.unit && !!m.definition),
    })),
  };
}
