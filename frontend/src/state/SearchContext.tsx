import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { search, SchemaError, type SearchResult } from '../lib/api';
import type { InputGravity, SearchInput } from '../types';

export interface FormState {
  crew_environment: SearchInput['crew_environment'];
  fire_safety_category: SearchInput['fire_safety_category'];
  research_topic: SearchInput['research_topic'];
  investigation: SearchInput['investigation'];
  fuel_type: SearchInput['fuel_type'];
  measurement_type: SearchInput['measurement_type'];
  oxygen_pct: string;
  pressure_kpa: string;
  airflow_cm_s: string;
  gravity_level: Exclude<InputGravity, null>;
  research_question: string;
}

/** Defaults taken from input.schema.json `default` values. */
export const DEFAULT_FORM: FormState = {
  crew_environment: 'All Environments', fire_safety_category: 'All Categories', research_topic: 'All Topics',
  investigation: 'All Investigations', fuel_type: 'All', measurement_type: 'All Measurements',
  oxygen_pct: '', pressure_kpa: '', airflow_cm_s: '', gravity_level: 'All', research_question: '',
};

const parseNum = (s: string) => (s.trim() === '' ? null : Number(s));

export function formErrors(f: FormState): Partial<Record<keyof FormState, string>> {
  const e: Partial<Record<keyof FormState, string>> = {};
  const check = (k: 'oxygen_pct' | 'pressure_kpa' | 'airflow_cm_s', max?: number) => {
    const v = parseNum(f[k]);
    if (v == null) return;
    if (!Number.isFinite(v)) e[k] = 'Enter a number';
    else if (v < 0) e[k] = 'Must be ≥ 0';
    else if (max != null && v > max) e[k] = `Must be ≤ ${max}`;
  };
  check('oxygen_pct', 100); check('pressure_kpa'); check('airflow_cm_s');
  return e;
}

export function toInput(f: FormState): SearchInput {
  return {
    crew_environment: f.crew_environment, fire_safety_category: f.fire_safety_category, research_topic: f.research_topic,
    investigation: f.investigation, fuel_type: f.fuel_type, measurement_type: f.measurement_type,
    conditions: { oxygen_pct: parseNum(f.oxygen_pct), pressure_kpa: parseNum(f.pressure_kpa), airflow_cm_s: parseNum(f.airflow_cm_s), gravity_level: f.gravity_level },
  };
}

type Status = 'idle' | 'loading' | 'ready' | 'error';

interface Ctx {
  form: FormState;
  setField: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  reset: () => void;
  advancedOpen: boolean;
  setAdvancedOpen: (v: boolean) => void;
  status: Status;
  error: { message: string; details: string[] } | null;
  result: SearchResult | null;
  submittedForm: FormState | null;
  apply: () => Promise<boolean>;
  /** experiment_ids in the comparison (2–3) */
  compareIds: string[];
  setCompareIds: (ids: string[]) => void;
  activeId: string | null;
  setActiveId: (id: string) => void;
}

const SearchCtx = createContext<Ctx | null>(null);
const KEY = 'fif.form.v1';

function load(): FormState {
  try { const s = sessionStorage.getItem(KEY); if (s) return { ...DEFAULT_FORM, ...JSON.parse(s) }; } catch { /* storage unavailable */ }
  return DEFAULT_FORM;
}

export function SearchProvider({ children }: { children: ReactNode }) {
  const [form, setForm] = useState<FormState>(load);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<Ctx['error']>(null);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [submittedForm, setSubmittedForm] = useState<FormState | null>(null);
  const [compareIds, setComparison] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify(form)); } catch { /* ignore */ } }, [form]);

  const setCompareIds = useCallback((ids: string[]) => {
    setComparison(ids);
    setActiveId((current) => current && ids.includes(current) ? current : ids[0] ?? null);
  }, []);

  const setField = useCallback(<K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v })), []);
  const reset = useCallback(() => { setForm(DEFAULT_FORM); setError(null); }, []);

  const apply = useCallback(async () => {
    if (Object.keys(formErrors(form)).length) return false;
    setStatus('loading'); setError(null);
    try {
      const r = await search({ input: toInput(form), research_question: form.research_question.trim() || null });
      setResult(r); setSubmittedForm(form); setStatus('ready');
      // Default comparison: use the leading investigation when it has at least two experiments.
      const pool = r.output.ranked.flatMap((inv) => inv.top_experiments.map((e) => e.experiment_id));
      const first = r.output.ranked[0]?.top_experiments.map((e) => e.experiment_id) ?? [];
      const ids = (first.length >= 2 ? first : pool).slice(0, 3);
      setCompareIds(ids); setActiveId(ids[0] ?? null);
      return true;
    } catch (e) {
      setStatus('error');
      setError(e instanceof SchemaError
        ? { message: `The ${e.stage} did not pass ${e.stage}_schema validation.`, details: e.errors }
        : { message: e instanceof Error ? e.message : 'Search failed', details: (e as { details?: string[] }).details ?? [] });
      return false;
    }
  }, [form, setCompareIds]);

  const value = useMemo<Ctx>(() => ({
    form, setField, reset, advancedOpen, setAdvancedOpen, status, error, result, submittedForm, apply,
    compareIds, setCompareIds, activeId, setActiveId: (id: string) => setActiveId(id),
  }), [form, setField, reset, advancedOpen, status, error, result, submittedForm, apply, compareIds, setCompareIds, activeId]);

  return <SearchCtx.Provider value={value}>{children}</SearchCtx.Provider>;
}

export function useSearch() {
  const c = useContext(SearchCtx);
  if (!c) throw new Error('useSearch outside SearchProvider');
  return c;
}
