import type { ExperimentRecord } from '../types';

/**
 * Maps one experiment/condition-set object from your backend (investigation_schema.json)
 * to the ExperimentRecord shape the charts and source panels use.
 * The default assumes the backend already returns ExperimentRecord-shaped objects.
 * Edit ONLY this function when your record field names differ.
 */
export function adaptBackendRecord(raw: unknown): ExperimentRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<ExperimentRecord>;
  if (!r.experiment_id || !r.psi_id || !Array.isArray(r.tests)) return null;
  if (r.demo === true || r.tests.some(t => !t || typeof t !== 'object' || !t.test_identifier || t.test_number == null)) return null;
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
    demo: false,
    // Keep only numerically valid measurements; never coerce strings into numbers.
    tests: r.tests.map((t) => ({
      ...t,
      oxygen_pct: typeof t.oxygen_pct === 'number' && Number.isFinite(t.oxygen_pct) ? t.oxygen_pct : null,
      pressure_kpa: typeof t.pressure_kpa === 'number' && Number.isFinite(t.pressure_kpa) ? t.pressure_kpa : null,
      airflow_cm_s: typeof t.airflow_cm_s === 'number' && Number.isFinite(t.airflow_cm_s) ? t.airflow_cm_s : null,
      outcome: t.outcome ?? null,
      measurements: (Array.isArray(t.measurements) ? t.measurements : []).filter((m) => m && typeof m.value === 'number' && Number.isFinite(m.value) && !!m.unit && !!m.definition),
    })),
  };
}
