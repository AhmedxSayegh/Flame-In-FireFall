/**
 * Local research-matching engine (used in demo mode, and as a reference implementation for
 * the backend). Pipeline: input → normalize → match each field → weighted score → rank →
 * pick top 3 experiments per investigation → build comparison → output_schema object.
 */
import type { CatalogInvestigation } from '../data/demoFixture';
import type {
  ExperimentRecord, FieldMatchKey, FieldMatches, MatchLevel, MatchString, OutputQuery, RankedInvestigation,
  SearchInput, SearchOutput, TopExperiment, TopExperimentsComparison,
} from '../types';
import { INVESTIGATIONS, QUANTITY_LABEL } from '../types';
import { deriveAttributes, fmtNum, MEASUREMENT_TO_QUANTITY, measurementGroups, outcomeCounts, rangeText, TABLE_ATTRIBUTES } from './records';
import { normalizeQuery, parseMatch } from './schema';

export const MATCH_POINTS: Record<MatchLevel, number> = { match: 1, partial: 0.5, unknown: 0.25, 'no match': 0 };
export const FIELD_WEIGHTS: Record<FieldMatchKey, number> = {
  research_topic: 1.5, measurement_type: 1.5, fuel_type: 1.25, fire_safety_category: 1, crew_environment: 1,
  investigation: 1, gravity: 1, oxygen: 0.75, pressure: 0.75, airflow: 0.75,
};
export const FIELD_LABEL: Record<FieldMatchKey, string> = {
  crew_environment: 'Crew environment', fire_safety_category: 'Fire safety category', research_topic: 'Research topic',
  investigation: 'Investigation', fuel_type: 'Fuel type', measurement_type: 'Measurement', oxygen: 'Oxygen',
  pressure: 'Pressure', airflow: 'Airflow', gravity: 'Gravity',
};

const isActive = (v: string | null | undefined) => v != null && v !== 'All';

/** Active filters from a normalized query, with the value the user chose. */
export function activeFilters(q: OutputQuery): Partial<Record<FieldMatchKey, string>> {
  const c = q.conditions ?? {};
  const out: Partial<Record<FieldMatchKey, string>> = {};
  (['crew_environment', 'fire_safety_category', 'research_topic', 'investigation', 'fuel_type', 'measurement_type'] as const)
    .forEach((k) => { if (isActive(q[k])) out[k] = q[k]!; });
  if (c.oxygen_pct != null) out.oxygen = `${c.oxygen_pct}% O₂`;
  if (c.pressure_kpa != null) out.pressure = `${c.pressure_kpa} kPa`;
  if (c.airflow_cm_s != null) out.airflow = `${c.airflow_cm_s} cm/s`;
  if (isActive(c.gravity)) out.gravity = c.gravity!;
  return out;
}

function numericMatch(target: number, values: number[], tol: number, unit: string): MatchString {
  if (!values.length) return 'unknown (not recorded in this investigation)';
  const nearest = values.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
  const lo = Math.min(...values), hi = Math.max(...values);
  if (Math.abs(nearest - target) <= tol) return `match (tested at ${fmtNum(nearest)} ${unit})`;
  if (target >= lo - 2 * tol && target <= hi + 2 * tol) return `partial (nearest tested ${fmtNum(nearest)} ${unit})`;
  return `no match (tested range ${rangeText(values, unit)})`;
}

function matchInvestigation(inv: CatalogInvestigation, q: OutputQuery): FieldMatches {
  const fm: FieldMatches = {};
  const act = activeFilters(q);
  for (const k of ['crew_environment', 'fire_safety_category', 'research_topic', 'fuel_type', 'measurement_type'] as const) {
    if (!act[k]) continue;
    const facet = inv.facets[k];
    fm[k] = !facet ? 'unknown (field not described in record)' : facet[act[k]!] ?? 'no match';
  }
  if (act.investigation) fm.investigation = inv.investigation === act.investigation ? 'match' : 'no match';
  const tests = inv.experiments.flatMap((e) => e.tests);
  const nums = (f: (t: (typeof tests)[number]) => number | null) => tests.map(f).filter((v): v is number => v != null);
  const c = q.conditions ?? {};
  if (c.oxygen_pct != null) fm.oxygen = numericMatch(c.oxygen_pct, nums((t) => t.oxygen_pct), 1, '% O₂');
  if (c.pressure_kpa != null) fm.pressure = numericMatch(c.pressure_kpa, nums((t) => t.pressure_kpa), Math.max(5, c.pressure_kpa * 0.05), 'kPa');
  if (c.airflow_cm_s != null) fm.airflow = numericMatch(c.airflow_cm_s, nums((t) => t.airflow_cm_s), Math.max(2, c.airflow_cm_s * 0.15), 'cm/s');
  if (act.gravity) {
    const g = new Set(inv.experiments.map((e) => e.gravity).filter(Boolean));
    if (!g.size) fm.gravity = 'unknown (gravity level not recorded)';
    else if (g.has(act.gravity as never)) fm.gravity = 'match';
    else if (act.gravity === 'microgravity' && g.has('simulated microgravity')) fm.gravity = 'partial (simulated microgravity only)';
    else fm.gravity = `no match (tested in ${[...g].join(', ')} only)`;
  }
  return fm;
}

export function scoreMatches(fm: FieldMatches): { score: number; method: string } {
  const keys = Object.keys(fm) as FieldMatchKey[];
  if (!keys.length) return { score: 100, method: 'No active filters: every investigation scores 100 (unranked).' };
  let got = 0, max = 0;
  const parts: string[] = [];
  for (const k of keys) {
    const p = MATCH_POINTS[parseMatch(fm[k]).level], w = FIELD_WEIGHTS[k];
    got += p * w; max += w;
    parts.push(`${FIELD_LABEL[k]} ${p}×${w}`);
  }
  const score = Math.round((got / max) * 100);
  return {
    score,
    method: `Weighted mean over ${keys.length} active filter${keys.length > 1 ? 's' : ''} (match 1, partial 0.5, unknown 0.25, no match 0): ${parts.join(' + ')} = ${fmtNum(got)} / ${fmtNum(max)} → ${score}/100.`,
  };
}

// ─── Experiment selection ──────────────────────────────────────────────────
function experimentScore(e: ExperimentRecord, q: OutputQuery): { s: number; why: string[] } {
  const why: string[] = [];
  let s = 0;
  const groups = measurementGroups(e);
  const mt = q.measurement_type;
  if (mt && mt !== 'All') {
    const qty = MEASUREMENT_TO_QUANTITY[mt];
    const n = groups.filter((g) => g.quantity === qty).reduce((a, g) => a + g.values.length, 0);
    if (n) { s += 3; why.push(`${n} ${QUANTITY_LABEL[qty].toLowerCase()} value${n > 1 ? 's' : ''}`); }
    if (qty === 'extinction_condition' && outcomeCounts(e)['Extinguished']) { s += 1; why.push('recorded extinctions'); }
  } else {
    s += groups.length;
    if (groups.length) why.push(`${groups.length} measured quantit${groups.length > 1 ? 'ies' : 'y'}`);
  }
  if (q.fuel_type && q.fuel_type !== 'All' && e.fuel_type === q.fuel_type) { s += 2; why.push(e.fuel_type); }
  const c = q.conditions ?? {};
  const close = (target: number | null | undefined, vals: (number | null)[], span: number, label: string) => {
    const v = vals.filter((x): x is number => x != null);
    if (target == null || !v.length) return;
    const d = Math.min(...v.map((x) => Math.abs(x - target)));
    s += 2 * (1 - Math.min(d / span, 1));
    if (d / span < 0.2) why.push(`${label} near target`);
  };
  close(c.oxygen_pct, e.tests.map((t) => t.oxygen_pct), 10, 'O₂');
  close(c.pressure_kpa, e.tests.map((t) => t.pressure_kpa), 50, 'pressure');
  close(c.airflow_cm_s, e.tests.map((t) => t.airflow_cm_s), 20, 'airflow');
  s += e.tests.length * 0.1;
  return { s, why };
}

function keyFindings(e: ExperimentRecord): string {
  const parts = [`${e.tests.length} test${e.tests.length === 1 ? '' : 's'} at ${rangeText(e.tests.map((t) => t.oxygen_pct), '% O₂')}, ${rangeText(e.tests.map((t) => t.pressure_kpa), 'kPa')}`
    + (e.tests.some((t) => t.airflow_cm_s != null) ? `, airflow ${rangeText(e.tests.map((t) => t.airflow_cm_s), 'cm/s')}` : '') + '.'];
  for (const g of measurementGroups(e)) {
    const mean = g.values.reduce((a, b) => a + b, 0) / g.values.length;
    parts.push(`${g.definition}: ${rangeText(g.values, g.unit)} (mean ${fmtNum(mean)} ${g.unit}, n=${g.values.length}).`);
  }
  const oc = outcomeCounts(e);
  if (Object.keys(oc).length) parts.push(`Recorded outcomes: ${Object.entries(oc).map(([k, n]) => `${k} ×${n}`).join(', ')}.`);
  const missing = e.tests.filter((t) => !t.measurements.length).map((t) => t.test_identifier);
  if (missing.length) parts.push(`No quantitative measurement recorded for ${missing.join(', ')}.`);
  return parts.join(' ');
}

function interpretation(e: ExperimentRecord, q: OutputQuery): string {
  const g = e.gravity ?? 'unrecorded gravity';
  const lines = [`[AI-assisted inference] These ${g} results describe ${e.fuel ?? 'the fuel'} behaviour under the listed conditions only.`];
  const oc = outcomeCounts(e);
  if (oc['Extinguished']) lines.push(`Extinction occurred in ${oc['Extinguished']} of ${e.tests.length} tests, which bounds conditions where a flame of this fuel can self-sustain.`);
  if (q.crew_environment && ['Lunar Base', 'Martian Base'].includes(q.crew_environment) && g === 'microgravity')
    lines.push(`They are not direct ${q.crew_environment === 'Lunar Base' ? 'lunar' : 'Martian'}-gravity tests; buoyant flow at partial gravity may change spread and extinction behaviour.`);
  lines.push('Conclusions should not be extrapolated beyond the tested oxygen, pressure and flow ranges.');
  return lines.join(' ');
}

export function compareRows(ids: string[], rows: { attribute: string; values: Record<string, string> }[]) {
  const similarities: string[] = [], differences: string[] = [];
  for (const r of rows) {
    if (['Test ID(s)', 'Relevance'].includes(r.attribute)) continue;
    const vals = ids.map((id) => r.values[id] ?? 'N/A');
    if (vals.every((v) => v === 'N/A')) continue;
    if (vals.every((v) => v === vals[0])) similarities.push(`${r.attribute}: ${vals[0]} for all.`);
    else differences.push(`${r.attribute}: ${vals.join(' vs ')}.`);
  }
  return { similarities, differences };
}

function buildComparison(tops: ExperimentRecord[], quality: string): TopExperimentsComparison {
  const ids = tops.map((e) => e.experiment_id);
  const attrs = tops.map(deriveAttributes);
  const compared_on = TABLE_ATTRIBUTES.filter((a) => a !== 'Relevance').map((attribute) => ({
    attribute, values: Object.fromEntries(ids.map((id, i) => [id, attrs[i][attribute] ?? 'N/A'])),
  }));
  const { similarities, differences } = compareRows(ids, compared_on);
  const nTests = tops.reduce((a, e) => a + e.tests.length, 0);
  const conclusion = tops.length < 2
    ? `Only one experiment is available, so no cross-experiment comparison is possible. Evidence: ${nTests} tests; ${quality}.`
    : `Together these ${tops.length} experiments (${nTests} tests) ${differences.length ? `differ mainly in ${differences.slice(0, 2).map((d) => d.split(':')[0].toLowerCase()).join(' and ')}` : 'share their recorded conditions'}, so differences in measured values can be read against those variables only. Confidence: ${quality}.`;
  return { experiment_ids: ids, compared_on, similarities, differences, conclusion };
}

// ─── Main entry ────────────────────────────────────────────────────────────
export function runEngine(input: SearchInput, catalog: CatalogInvestigation[]): SearchOutput {
  const query = normalizeQuery(input);
  const act = activeFilters(query);
  const pool = act.investigation ? catalog.filter((c) => c.investigation === act.investigation) : catalog;

  const scored = pool.map((inv) => {
    const fm = matchInvestigation(inv, query);
    return { inv, fm, ...scoreMatches(fm) };
  }).sort((a, b) => b.score - a.score);

  const ranked: RankedInvestigation[] = scored.map(({ inv, fm, score, method }, i) => {
    const exps = inv.experiments.map((e) => ({ e, ...experimentScore(e, query) })).sort((a, b) => b.s - a.s);
    const tops = exps.slice(0, 3);
    const quality = score >= 75 ? 'strong match' : score >= 50 ? 'moderate match' : 'weak match';
    const top_experiments: TopExperiment[] = tops.map(({ e, why }, j) => ({
      rank: j + 1,
      experiment_id: e.experiment_id,
      tests: e.tests.map((t) => ({ test_number: t.test_number, test_identifier: t.test_identifier })),
      experiment: e.label,
      why_selected: why.length ? `Selected for: ${why.join(', ')}.` : 'Selected by data availability.',
      summary_of_key_findings: keyFindings(e),
      fire_safety_interpretation: interpretation(e, query),
      evidence: [`${inv.psi_id} condition_sets (${e.experiment_id})`, ...inv.source_files],
    }));
    return {
      psi_id: inv.psi_id, name: inv.name, reference_link: inv.reference_link, rank: i + 1,
      relevance_score: score, score_method: method, field_matches: fm, top_experiments,
      runner_up: exps[3] ? `${exps[3].e.experiment_id} — ${exps[3].e.label}` : null,
      top_experiments_comparison: buildComparison(tops.map((t) => t.e), quality),
    };
  });

  // Gaps, caveats, insights — derived from what the records do and do not cover.
  const gaps: string[] = [];
  const loaded = new Set(catalog.map((c) => c.investigation));
  const missingInv = INVESTIGATIONS.filter((x) => x !== 'All Investigations' && !loaded.has(x));
  if (act.investigation && !pool.length) gaps.push(`No records loaded for ${act.investigation}; results are empty for this investigation filter.`);
  else if (missingInv.length) gaps.push(`No records loaded for ${missingInv.join(', ')}; ranking covers ${[...loaded].join(', ')} only.`);
  const fieldGap = (k: FieldMatchKey, msg: string) => {
    if (act[k] && ranked.length && ranked.every((r) => parseMatch(r.field_matches[k]).level !== 'match')) gaps.push(msg);
  };
  fieldGap('measurement_type', `No loaded investigation directly measures ${act.measurement_type}.`);
  fieldGap('fuel_type', `No loaded investigation tested ${act.fuel_type}.`);
  fieldGap('research_topic', `No loaded investigation directly addresses ${act.research_topic}.`);
  fieldGap('oxygen', `No tests at the requested oxygen concentration (${act.oxygen}).`);
  fieldGap('pressure', `No tests at the requested pressure (${act.pressure}).`);
  fieldGap('airflow', `No tests at the requested airflow (${act.airflow}).`);
  fieldGap('gravity', `No tests at the requested gravity level (${act.gravity}).`);
  if (act.crew_environment === 'Lunar Base' || act.crew_environment === 'Martian Base')
    gaps.push(`No direct ${act.crew_environment === 'Lunar Base' ? 'lunar' : 'Martian'}-gravity tests: microgravity results are indirect evidence for this environment.`);

  const caveats = [
    'Relevance scores measure how well records match the search filters — not fire risk and not scientific certainty.',
    'Scientific interpretations marked [AI-assisted inference] are generated, not taken from the source record.',
    'Only measurements with identical definitions and units are plotted together.',
  ];
  if (catalog.some((c) => c.demo)) caveats.unshift('DEMO DATA: values are synthetic placeholders for interface testing, not NASA PSI measurements.');

  const top = ranked[0];
  const match_quality = !top
    ? 'weak — no investigation records match the selected investigation filter.'
    : top.relevance_score >= 75 ? `strong — ${top.name} matches ${Object.values(top.field_matches).filter((v) => parseMatch(v).level === 'match').length} of ${Object.keys(top.field_matches).length} active filters.`
      : top.relevance_score >= 50 ? `partial — best result ${top.name} scores ${top.relevance_score}/100; several filters match only partially.`
        : `weak — best result ${top.name} scores ${top.relevance_score}/100; the records only indirectly address this search.`;

  const overall_insights = top ? [
    `${top.name} ranks first at ${top.relevance_score}/100.`,
    `${ranked.reduce((a, r) => a + r.top_experiments.length, 0)} experiments selected across ${ranked.length} investigation${ranked.length > 1 ? 's' : ''}.`,
  ] : [];

  return { query, inputs_used: pool.flatMap((c) => c.source_files), match_quality, ranked, overall_insights, gaps, caveats };
}
