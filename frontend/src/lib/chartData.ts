/**
 * Chart-data transformation layer. Reads ONLY numeric fields of ExperimentRecord tests.
 * Never parses numbers out of narrative strings. Groups by (quantity, unit, definition)
 * so incompatible definitions are never drawn on the same axis.
 */
import type { ExperimentRecord, Quantity, TestRecord } from '../types';

export const SERIES_COLORS = ['#EA8B33', '#32667F', '#F3B940', '#EEA23A', '#132F45'];
export const SERIES_SHAPES = ['circle', 'square', 'triangle', 'diamond', 'star'] as const;

export type XVar = 'oxygen_pct' | 'airflow_cm_s' | 'pressure_kpa';
export const XVAR_META: Record<XVar, { label: string; unit: string }> = {
  oxygen_pct: { label: 'Oxygen concentration', unit: '% O₂' },
  airflow_cm_s: { label: 'Airflow velocity', unit: 'cm/s' },
  pressure_kpa: { label: 'Pressure', unit: 'kPa' },
};

export interface Pt {
  x: number; y: number; exp: string; test: string; test_number: number | string;
  outcome: string | null; o2: number | null; p: number | null; u: number | null;
}

export interface MeasureGroup { key: string; quantity: Quantity; unit: string; definition: string; count: number }

export function groupsFor(records: ExperimentRecord[], quantity: Quantity): MeasureGroup[] {
  const map = new Map<string, MeasureGroup>();
  for (const r of records) for (const t of r.tests) for (const m of t.measurements) {
    if (m.quantity !== quantity) continue;
    const key = `${m.unit}|${m.definition}`;
    const g = map.get(key) ?? { key, quantity, unit: m.unit, definition: m.definition, count: 0 };
    g.count++; map.set(key, g);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

const valueOf = (t: TestRecord, q: Quantity, groupKey: string) =>
  t.measurements.find((m) => m.quantity === q && `${m.unit}|${m.definition}` === groupKey)?.value;

export interface ScatterData {
  series: { exp: string; points: Pt[] }[];
  /** tests that had the y-measurement but no x value (excluded from plot) */
  missingX: string[];
  /** experiments with no value in this measurement group */
  noData: string[];
}

export function scatterData(records: ExperimentRecord[], quantity: Quantity, groupKey: string, x: XVar): ScatterData {
  const missingX: string[] = [], noData: string[] = [];
  const series = records.map((r) => {
    const points: Pt[] = [];
    for (const t of r.tests) {
      const y = valueOf(t, quantity, groupKey);
      if (y == null) continue;
      const xv = t[x];
      if (xv == null) { missingX.push(t.test_identifier); continue; }
      points.push({ x: xv, y, exp: r.experiment_id, test: t.test_identifier, test_number: t.test_number, outcome: t.outcome, o2: t.oxygen_pct, p: t.pressure_kpa, u: t.airflow_cm_s });
    }
    if (!points.length && !r.tests.some((t) => valueOf(t, quantity, groupKey) != null)) noData.push(r.experiment_id);
    return { exp: r.experiment_id, points: points.sort((a, b) => a.x - b.x) };
  });
  return { series, missingX, noData };
}

export interface BarRow { exp: string; label: string; mean: number; min: number; max: number; n: number; err: [number, number]; tests: string[] }

export function barData(records: ExperimentRecord[], quantity: Quantity, groupKey: string): BarRow[] {
  const rows: BarRow[] = [];
  for (const r of records) {
    const vals: number[] = [], tests: string[] = [];
    for (const t of r.tests) { const v = valueOf(t, quantity, groupKey); if (v != null) { vals.push(v); tests.push(t.test_identifier); } }
    if (!vals.length) continue;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const min = Math.min(...vals), max = Math.max(...vals);
    rows.push({ exp: r.experiment_id, label: r.fuel ?? r.label, mean, min, max, n: vals.length, err: [mean - min, max - mean], tests });
  }
  return rows;
}

export interface OutcomePt { x: number; y: string; exp: string; n: number; tests: string[] }

/** Oxygen vs recorded outcome. Aggregates identical (exp, O₂, outcome) into one mark sized by count. */
export function outcomeVsO2(records: ExperimentRecord[]) {
  const series = records.map((r) => {
    const m = new Map<string, OutcomePt>();
    for (const t of r.tests) {
      if (t.outcome == null || t.oxygen_pct == null) continue;
      const k = `${t.oxygen_pct}|${t.outcome}`;
      const p = m.get(k) ?? { x: t.oxygen_pct, y: t.outcome, exp: r.experiment_id, n: 0, tests: [] };
      p.n++; p.tests.push(t.test_identifier); m.set(k, p);
    }
    return { exp: r.experiment_id, points: [...m.values()] };
  });
  const categories = [...new Set(series.flatMap((s) => s.points.map((p) => p.y)))].sort();
  return { series, categories };
}

export function outcomeDistribution(records: ExperimentRecord[]) {
  const outcomes = [...new Set(records.flatMap((r) => r.tests.map((t) => t.outcome).filter((o): o is string => !!o)))].sort();
  const rows = outcomes.map((o) => {
    const row: Record<string, string | number> = { outcome: o };
    for (const r of records) row[r.experiment_id] = r.tests.filter((t) => t.outcome === o).length;
    return row;
  });
  const unrecorded = records.flatMap((r) => r.tests.filter((t) => !t.outcome).map((t) => t.test_identifier));
  return { rows, outcomes, unrecorded };
}

export function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

export function downloadCSV(name: string, rows: Record<string, unknown>[]) {
  const blob = new Blob([toCSV(rows)], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
