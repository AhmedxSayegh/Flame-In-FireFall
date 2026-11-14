import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
// The same JSON files the backend validates against (one source of truth).
import inputSchema from '../../../shared/schemas/input.schema.json';
import outputSchema from '../../../shared/schemas/output.schema.json';
import type { InputGravity, MatchLevel, SearchInput, SearchOutput } from '../types';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const validateInputFn = ajv.compile<SearchInput>(inputSchema);
const validateOutputFn = ajv.compile<SearchOutput>(outputSchema);

export interface ValidationResult { ok: boolean; errors: string[] }

function fmt(errors: typeof validateInputFn.errors): string[] {
  return (errors ?? []).map((e) => `${e.instancePath || '(root)'} ${e.message ?? ''}`.trim());
}

export function validateInput(input: unknown): ValidationResult {
  const ok = validateInputFn(input);
  return { ok, errors: ok ? [] : fmt(validateInputFn.errors) };
}

export function validateOutput(output: unknown): ValidationResult {
  const ok = validateOutputFn(output);
  return { ok, errors: ok ? [] : fmt(validateOutputFn.errors) };
}

/** Builds a schema-clean input object: drops null/empty conditions so `additionalProperties:false` holds. */
export function cleanInput(input: SearchInput): SearchInput {
  const c = input.conditions ?? {};
  const conditions: SearchInput['conditions'] = {};
  if (c.oxygen_pct != null) conditions.oxygen_pct = c.oxygen_pct;
  if (c.pressure_kpa != null) conditions.pressure_kpa = c.pressure_kpa;
  if (c.airflow_cm_s != null) conditions.airflow_cm_s = c.airflow_cm_s;
  conditions.gravity_level = (c.gravity_level ?? 'All') as InputGravity;
  return { ...input, conditions };
}

export function parseMatch(s: string | undefined): { level: MatchLevel; reason: string | null } {
  if (!s) return { level: 'unknown', reason: null };
  const m = /^(match|partial|no match|unknown)(?: \((.+)\))?$/.exec(s);
  if (!m) return { level: 'unknown', reason: s };
  return { level: m[1] as MatchLevel, reason: m[2] ?? null };
}
