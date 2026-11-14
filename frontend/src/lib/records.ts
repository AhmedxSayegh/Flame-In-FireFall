import type { ExperimentRecord, MeasurementType, Quantity } from '../types';
import { QUANTITY_LABEL } from '../types';

export const NA = 'N/A';

export const TABLE_ATTRIBUTES = [
  'Investigation / PSI ID', 'Test ID(s)', 'Fuel / Material', 'Fuel Type', 'Sample Shape / Size',
  'Oxygen Concentration', 'Atmospheric Pressure', 'Airflow Velocity', 'Gravity Level',
  'Number of Tests', 'Measurement', 'Experimental Outcome', 'Relevance',
] as const;

/** Aliases so backend `compared_on` rows ("Oxygen", "Fuel", "Tests"…) land on the right table row. */
export const ATTRIBUTE_ALIASES: Record<string, (typeof TABLE_ATTRIBUTES)[number]> = {
  investigation: 'Investigation / PSI ID', 'psi id': 'Investigation / PSI ID',
  'test ids': 'Test ID(s)', 'test id(s)': 'Test ID(s)',
  fuel: 'Fuel / Material', material: 'Fuel / Material', 'fuel / material': 'Fuel / Material',
  'fuel type': 'Fuel Type', sample: 'Sample Shape / Size', 'sample shape / size': 'Sample Shape / Size',
  oxygen: 'Oxygen Concentration', 'oxygen concentration': 'Oxygen Concentration', o2: 'Oxygen Concentration',
  pressure: 'Atmospheric Pressure', 'atmospheric pressure': 'Atmospheric Pressure',
  airflow: 'Airflow Velocity', 'airflow velocity': 'Airflow Velocity', flow: 'Airflow Velocity',
  gravity: 'Gravity Level', 'gravity level': 'Gravity Level',
  tests: 'Number of Tests', 'number of tests': 'Number of Tests',
  measurement: 'Measurement', 'burning rate': 'Measurement',
  outcomes: 'Experimental Outcome', outcome: 'Experimental Outcome', 'experimental outcome': 'Experimental Outcome',
  relevance: 'Relevance',
};

export const MEASUREMENT_TO_QUANTITY: Record<Exclude<MeasurementType, 'All Measurements'>, Quantity> = {
  'Flame Spread Rate': 'flame_spread_rate',
  'Flame Size': 'flame_size',
  'Burning Rate': 'burning_rate',
  'Extinction Conditions': 'extinction_condition',
  'Smoke Particle Size': 'smoke_particle_size',
  'Detector Response': 'detector_response',
};

export const fmtNum = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(Math.abs(v) < 10 ? 2 : 1).replace(/\.?0+$/, ''));

export function rangeText(values: (number | null)[], unit: string): string {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!nums.length) return NA;
  const lo = Math.min(...nums), hi = Math.max(...nums);
  return lo === hi ? `${fmtNum(lo)} ${unit}` : `${fmtNum(lo)}–${fmtNum(hi)} ${unit}`;
}

export function outcomeCounts(rec: ExperimentRecord): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of rec.tests) if (t.outcome) out[t.outcome] = (out[t.outcome] ?? 0) + 1;
  return out;
}

export function measurementGroups(rec: ExperimentRecord) {
  const g = new Map<string, { quantity: Quantity; unit: string; definition: string; values: number[] }>();
  for (const t of rec.tests)
    for (const m of t.measurements) {
      const k = `${m.quantity}|${m.unit}|${m.definition}`;
      if (!g.has(k)) g.set(k, { quantity: m.quantity, unit: m.unit, definition: m.definition, values: [] });
      g.get(k)!.values.push(m.value);
    }
  return [...g.values()];
}

export function measurementText(rec: ExperimentRecord): string {
  const groups = measurementGroups(rec);
  if (!groups.length) return NA;
  return groups.map((g) => `${QUANTITY_LABEL[g.quantity]}: ${rangeText(g.values, g.unit)} (n=${g.values.length})`).join('; ');
}

/** Table values derived strictly from the record. Anything absent → "N/A". */
export function deriveAttributes(rec: ExperimentRecord): Record<string, string> {
  const oc = outcomeCounts(rec);
  return {
    'Investigation / PSI ID': `${rec.investigation} / ${rec.psi_id}`,
    'Test ID(s)': rec.tests.map((t) => t.test_identifier).join(', ') || NA,
    'Fuel / Material': rec.fuel ?? NA,
    'Fuel Type': rec.fuel_type ?? NA,
    'Sample Shape / Size': rec.sample ?? NA,
    'Oxygen Concentration': rangeText(rec.tests.map((t) => t.oxygen_pct), '% O₂'),
    'Atmospheric Pressure': rangeText(rec.tests.map((t) => t.pressure_kpa), 'kPa'),
    'Airflow Velocity': rangeText(rec.tests.map((t) => t.airflow_cm_s), 'cm/s'),
    'Gravity Level': rec.gravity ?? NA,
    'Number of Tests': String(rec.tests.length),
    Measurement: measurementText(rec),
    'Experimental Outcome': Object.keys(oc).length ? Object.entries(oc).map(([k, n]) => `${k} ×${n}`).join(', ') : NA,
  };
}
