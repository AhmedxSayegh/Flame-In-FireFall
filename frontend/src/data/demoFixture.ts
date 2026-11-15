/**
 * DEMO FIXTURE — SYNTHETIC VALUES FOR UI DEVELOPMENT ONLY.
 * These are NOT NASA PSI measurements. They exist so every chart and table path can be
 * exercised before the backend is connected. Every record is flagged `demo: true`, and the
 * UI shows a banner whenever demo data is on screen. Replace via VITE_DATA_SOURCE=api.
 */
import type { ExperimentRecord, FieldMatchKey, MatchString, Measurement, TestRecord } from '../types';

export interface CatalogInvestigation {
  psi_id: string;
  name: string;
  /** Must be one of the input schema's investigation enum values */
  investigation: string;
  reference_link: string;
  source_files: string[];
  /** Per filter value: how this investigation relates to it. Values not listed → "no match". */
  facets: Partial<Record<Exclude<FieldMatchKey, 'investigation' | 'oxygen' | 'pressure' | 'airflow' | 'gravity'>, Record<string, MatchString>>>;
  experiments: ExperimentRecord[];
  demo: boolean;
}

const PSI_PORTAL = 'https://psi.ndc.nasa.gov/';

const m = (quantity: Measurement['quantity'], value: number, unit: string, definition: string): Measurement => ({ quantity, value, unit, definition });
const K = (v: number) => m('burning_rate', v, 'mm²/s', 'Droplet burning-rate constant K (d²-law slope)');
const dExt = (v: number) => m('extinction_condition', v, 'mm', 'Droplet diameter at flame extinction');
const Vf = (v: number) => m('flame_spread_rate', v, 'mm/s', 'Upstream (opposed-flow) flame spread rate');
const rr = (v: number) => m('burning_rate', v, 'µm/s', 'Solid surface regression rate');

function t(n: number, id: string, o2: number | null, p: number | null, u: number | null, outcome: string | null, ms: Measurement[]): TestRecord {
  return { test_number: n, test_identifier: id, oxygen_pct: o2, pressure_kpa: p, airflow_cm_s: u, outcome, measurements: ms };
}

const demoSources = (psi: string) => [
  { label: `${psi} dataset (demo placeholder — replace with backend source)`, url: PSI_PORTAL, kind: 'dataset' as const, verified: false },
];

export const DEMO_CATALOG: CatalogInvestigation[] = [
  {
    psi_id: 'DEMO-FLEX',
    name: 'FLEX — Flame Extinguishment Experiment (demo record)',
    investigation: 'FLEX',
    reference_link: PSI_PORTAL,
    source_files: ['demo_flex_record.json'],
    demo: true,
    facets: {
      crew_environment: {
        'Space Station': 'match (experiment set conducted aboard an orbiting station)',
        Spacecraft: 'partial (microgravity applies, cabin conditions differ)',
        'Lunar Base': 'partial (microgravity data only, no lunar-gravity tests)',
        'Martian Base': 'partial (microgravity data only, no Martian-gravity tests)',
        'Pressurized Rover': 'partial (microgravity data only, not rover conditions)',
      },
      fire_safety_category: {
        'Fire Suppression': 'match',
        'Fire Prevention': 'partial (extinction limits inform prevention, indirectly)',
      },
      research_topic: { 'Flame Extinction': 'match', 'Combustion Behavior': 'match' },
      fuel_type: { 'Liquid Fuels': 'match' },
      measurement_type: { 'Burning Rate': 'match', 'Extinction Conditions': 'match', 'Flame Size': 'partial (diameter histories, not flame standoff)' },
    },
    experiments: [
      {
        experiment_id: 'DEMO-FLEX-CS01', psi_id: 'DEMO-FLEX', investigation: 'FLEX', demo: true,
        label: 'n-heptane · 21% O₂ · 101.3 kPa', fuel: 'n-heptane', fuel_type: 'Liquid Fuels',
        sample: 'Free-floating droplet, d₀ 3.0–3.6 mm', gravity: 'microgravity', sources: demoSources('DEMO-FLEX'),
        tests: [
          t(1, 'DEMO-F001', 21, 101.3, null, 'Extinguished', [K(0.64), dExt(1.1)]),
          t(2, 'DEMO-F002', 21, 101.3, null, 'Extinguished', [K(0.66), dExt(1.3)]),
          t(3, 'DEMO-F003', 21, 101.3, null, 'Burned to completion', [K(0.61)]),
          t(4, 'DEMO-F004', 21, 101.3, null, 'Extinguished', [K(0.63), dExt(1.0)]),
        ],
      },
      {
        experiment_id: 'DEMO-FLEX-CS02', psi_id: 'DEMO-FLEX', investigation: 'FLEX', demo: true,
        label: 'n-heptane · 17% O₂ · 101.3 kPa', fuel: 'n-heptane', fuel_type: 'Liquid Fuels',
        sample: 'Free-floating droplet, d₀ 3.1–3.8 mm', gravity: 'microgravity', sources: demoSources('DEMO-FLEX'),
        tests: [
          t(5, 'DEMO-F005', 17, 101.3, null, 'Extinguished', [K(0.52), dExt(1.9)]),
          t(6, 'DEMO-F006', 17, 101.3, null, 'Extinguished', [K(0.49), dExt(2.2)]),
          t(7, 'DEMO-F007', 17, 101.3, null, 'Disrupted', []),
          t(8, 'DEMO-F008', 17, 101.3, null, 'Extinguished', [K(0.50), dExt(2.0)]),
        ],
      },
      {
        experiment_id: 'DEMO-FLEX-CS03', psi_id: 'DEMO-FLEX', investigation: 'FLEX', demo: true,
        label: 'n-heptane · 15% O₂ · 101.3 kPa', fuel: 'n-heptane', fuel_type: 'Liquid Fuels',
        sample: 'Free-floating droplet, d₀ 3.4–3.9 mm', gravity: 'microgravity', sources: demoSources('DEMO-FLEX'),
        tests: [
          t(9, 'DEMO-F009', 15, 101.3, null, 'Extinguished', [K(0.44), dExt(2.9)]),
          t(10, 'DEMO-F010', 15, 101.3, null, 'Extinguished', [K(0.41), dExt(3.1)]),
          t(11, 'DEMO-F011', 15, 101.3, null, 'Extinguished', [dExt(3.0)]),
        ],
      },
      {
        experiment_id: 'DEMO-FLEX-CS04', psi_id: 'DEMO-FLEX', investigation: 'FLEX', demo: true,
        label: 'Methanol · 30% O₂ · 50.7 kPa', fuel: 'Methanol', fuel_type: 'Liquid Fuels',
        sample: 'Fiber-supported droplet, d₀ 2.4–2.9 mm', gravity: 'microgravity', sources: demoSources('DEMO-FLEX'),
        tests: [
          t(12, 'DEMO-F012', 30, 50.7, null, 'Burned to completion', [K(0.71)]),
          t(13, 'DEMO-F013', 30, 50.7, null, 'Extinguished', [K(0.69), dExt(0.8)]),
          t(14, 'DEMO-F014', 30, 50.7, null, 'Burned to completion', [K(0.74)]),
        ],
      },
    ],
  },
  {
    psi_id: 'DEMO-BASS-II',
    name: 'BASS-II — Burning and Suppression of Solids II (demo record)',
    investigation: 'BASS-II',
    reference_link: PSI_PORTAL,
    source_files: ['demo_bass2_record.json'],
    demo: true,
    facets: {
      crew_environment: {
        'Space Station': 'match (experiment set conducted aboard an orbiting station)',
        Spacecraft: 'partial (ventilation flows comparable, cabin geometry differs)',
        'Lunar Base': 'partial (microgravity data only, no lunar-gravity tests)',
        'Martian Base': 'partial (microgravity data only, no Martian-gravity tests)',
        'Pressurized Rover': 'partial (microgravity data only, not rover conditions)',
      },
      fire_safety_category: {
        'Fire Growth & Spread': 'match',
        'Fire Prevention': 'match',
        'Fire Suppression': 'partial (low-flow extinction recorded; no suppressant tests in this record)',
      },
      research_topic: { 'Flame Spread': 'match', 'Material Flammability': 'match', 'Flame Extinction': 'partial (flow-limited extinction only)' },
      fuel_type: { 'Solid Materials': 'match' },
      measurement_type: { 'Flame Spread Rate': 'match', 'Burning Rate': 'partial (regression rate, different definition)', 'Extinction Conditions': 'partial (outcome only)' },
    },
    experiments: [
      {
        experiment_id: 'DEMO-BASS2-CS01', psi_id: 'DEMO-BASS-II', investigation: 'BASS-II', demo: true,
        label: 'PMMA sheet · 21% O₂ · opposed flow', fuel: 'PMMA (thin sheet)', fuel_type: 'Solid Materials',
        sample: 'Flat sheet, 1 cm × 10 cm, 0.2 mm thick', gravity: 'microgravity', sources: demoSources('DEMO-BASS-II'),
        tests: [
          t(1, 'DEMO-B101', 21, 101.3, 5, 'Extinguished', [Vf(0.42)]),
          t(2, 'DEMO-B102', 21, 101.3, 10, 'Continued burning', [Vf(0.95)]),
          t(3, 'DEMO-B103', 21, 101.3, 20, 'Continued burning', [Vf(1.31)]),
          t(4, 'DEMO-B104', 21, 101.3, 30, 'Continued burning', [Vf(1.48)]),
        ],
      },
      {
        experiment_id: 'DEMO-BASS2-CS02', psi_id: 'DEMO-BASS-II', investigation: 'BASS-II', demo: true,
        label: 'PMMA sheet · 16% O₂ · opposed flow', fuel: 'PMMA (thin sheet)', fuel_type: 'Solid Materials',
        sample: 'Flat sheet, 1 cm × 10 cm, 0.2 mm thick', gravity: 'microgravity', sources: demoSources('DEMO-BASS-II'),
        tests: [
          t(5, 'DEMO-B105', 16, 101.3, 5, 'Extinguished', []),
          t(6, 'DEMO-B106', 16, 101.3, 10, 'Extinguished', [Vf(0.28)]),
          t(7, 'DEMO-B107', 16, 101.3, 20, 'Continued burning', [Vf(0.61)]),
          t(8, 'DEMO-B108', 16, 101.3, 30, 'Continued burning', [Vf(0.74)]),
        ],
      },
      {
        experiment_id: 'DEMO-BASS2-CS03', psi_id: 'DEMO-BASS-II', investigation: 'BASS-II', demo: true,
        label: 'PMMA cylinder · 21% O₂ · axial flow', fuel: 'PMMA (cylinder)', fuel_type: 'Solid Materials',
        sample: 'Cylinder, 6.4 mm dia.', gravity: 'microgravity', sources: demoSources('DEMO-BASS-II'),
        tests: [
          t(9, 'DEMO-B109', 21, 101.3, 10, 'Continued burning', [rr(3.1)]),
          t(10, 'DEMO-B110', 21, 101.3, 20, 'Continued burning', [rr(4.0)]),
          t(11, 'DEMO-B111', 21, 101.3, 30, 'Completed', [rr(4.6)]),
        ],
      },
    ],
  },
];
