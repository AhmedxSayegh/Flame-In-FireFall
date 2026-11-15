import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { search, SchemaError, type SearchResult } from '../lib/api';
import type { InputGravity, SearchInput } from '../types';
import { experimentsForInvestigation, selectWorkspace, validComparisonIds, type WorkspaceSelection } from './selection';

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
  /** Experiment shown in analysis; may only be selected within the active investigation. */
  activeId: string | null;
  setActiveId: (id: string) => void;
  /** psi_id highlighted in the ranking panel */
  investigationId: string | null;
  /** Updates the shared investigation and reconciles all experiment selections. */
  selectInvestigation: (psiId: string) => void;
}

const SearchCtx = createContext<Ctx | null>(null);
const KEY = 'fif.form.v1';

function load(): FormState {
  try { const s = sessionStorage.getItem(KEY); if (s) return { ...DEFAULT_FORM, ...JSON.parse(s), research_question: '' }; } catch { /* storage unavailable */ }
  return DEFAULT_FORM;
}

export function SearchProvider({ children }: { children: ReactNode }) {
  const [form, setForm] = useState<FormState>(load);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<Ctx['error']>(null);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [submittedForm, setSubmittedForm] = useState<FormState | null>(null);
  const [selection, setSelection] = useState<WorkspaceSelection>({ investigationId: null, activeId: null, compareIds: [] });
  const { compareIds, activeId, investigationId } = selection;
  const inFlight = useRef(false);

  const setActiveId = useCallback((id: string) => {
    setSelection(current => experimentsForInvestigation(result?.output.ranked ?? [], current.investigationId)
      .some(exp => exp.experiment_id === id) ? { ...current, activeId: id } : current);
  }, [result]);

  const setCompareIds = useCallback((ids: string[]) => {
    setSelection(current => ({ ...current, compareIds: validComparisonIds(ids,
      experimentsForInvestigation(result?.output.ranked ?? [], current.investigationId)) }));
  }, [result]);

  const selectInvestigation = useCallback((psiId: string) => {
    const inv = result?.output.ranked.find((r) => r.psi_id === psiId);
    if (!inv) return;
    setSelection(current => current.investigationId === psiId ? current
      : selectWorkspace(result!.output.ranked, psiId, current));
  }, [result]);

  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify(form)); } catch { /* ignore */ } }, [form]);

  const setField = useCallback(<K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v, research_question: '' })), []);
  const reset = useCallback(() => { setForm(DEFAULT_FORM); setError(null); }, []);

  const apply = useCallback(async () => {
    if (inFlight.current) return false;
    if (Object.keys(formErrors(form)).length) return false;
    inFlight.current = true;
    setStatus('loading'); setError(null);
    try {
      const r = await search({ input: toInput(form), research_question: null });
      setResult(r); setSubmittedForm({ ...form, research_question: '' }); setStatus('ready');
      setSelection(selectWorkspace(r.output.ranked, r.output.ranked[0]?.psi_id ?? null));
      return true;
    } catch (e) {
      setStatus('error');
      setError(e instanceof SchemaError
        ? { message: `The ${e.stage} did not pass ${e.stage}_schema validation.`, details: e.errors }
        : { message: e instanceof Error ? e.message : 'Search failed', details: (e as {details?:string[]}).details ?? [] });
      return false;
    } finally {
      inFlight.current = false;
    }
  }, [form]);

  const value = useMemo<Ctx>(() => ({
    form, setField, reset, advancedOpen, setAdvancedOpen, status, error, result, submittedForm, apply,
    compareIds, setCompareIds, activeId, setActiveId, investigationId, selectInvestigation,
  }), [form, setField, reset, advancedOpen, status, error, result, submittedForm, apply, compareIds, setCompareIds, activeId, setActiveId, investigationId, selectInvestigation]);

  return <SearchCtx.Provider value={value}>{children}</SearchCtx.Provider>;
}

export function useSearch() {
  const c = useContext(SearchCtx);
  if (!c) throw new Error('useSearch outside SearchProvider');
  return c;
}
