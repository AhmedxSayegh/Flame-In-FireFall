import { ChevronDown } from 'lucide-react';
import { formErrors, useSearch, type FormState } from '../state/SearchContext';
import {
  CREW_ENVIRONMENTS, FIRE_SAFETY_CATEGORIES, FUEL_TYPES, GRAVITY_LEVELS, INVESTIGATIONS, MEASUREMENT_TYPES, RESEARCH_TOPICS,
} from '../types';
import inputSchema from '../../../shared/schemas/input.schema.json';

function Select<K extends keyof FormState>({ k, label, options }: { k: K; label: string; options: readonly string[] }) {
  const { form, setField } = useSearch();
  return (
    <div>
      <label className="label" htmlFor={k}>{label}</label>
      <select id={k} className="field" value={form[k] as string} onChange={(e) => setField(k, e.target.value as FormState[K])}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

export function ResearchFilters() {
  return (
    <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
      <Select k="crew_environment" label="Crew Environment" options={CREW_ENVIRONMENTS} />
      <Select k="fire_safety_category" label="Fire Safety Category" options={FIRE_SAFETY_CATEGORIES} />
      <Select k="research_topic" label="Research Topic" options={RESEARCH_TOPICS} />
      <Select k="investigation" label="Investigation" options={INVESTIGATIONS} />
      <Select k="fuel_type" label="Material / Fuel Type" options={FUEL_TYPES} />
      <Select k="measurement_type" label="Measurement Type" options={MEASUREMENT_TYPES} />
    </div>
  );
}

const condProps = (inputSchema as { properties: { conditions: { properties: Record<string, { description?: string; minimum?: number; maximum?: number }> } } }).properties.conditions.properties;

function NumField({ k, label, unit }: { k: 'oxygen_pct' | 'pressure_kpa' | 'airflow_cm_s'; label: string; unit: string }) {
  const { form, setField } = useSearch();
  const err = formErrors(form)[k];
  const p = condProps[k];
  return (
    <div>
      <label className="label" htmlFor={k}>{label}</label>
      <div className="relative">
        <input
          id={k} inputMode="decimal" type="number" step="any" min={p.minimum} max={p.maximum}
          className="field pr-14 tnum" placeholder="Any" aria-invalid={!!err}
          value={form[k]} onChange={(e) => setField(k, e.target.value)}
        />
        <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-muted">{unit}</span>
      </div>
      <p className={`mt-1.5 text-xs ${err ? 'text-[#B4472A]' : 'text-muted'}`}>{err ?? p.description}</p>
    </div>
  );
}

export function AdvancedFilters() {
  const { advancedOpen, setAdvancedOpen, form } = useSearch();
  const activeCount = [form.oxygen_pct, form.pressure_kpa, form.airflow_cm_s].filter((v) => v.trim() !== '').length + (form.gravity_level !== 'All' ? 1 : 0);
  return (
    <div className="border-y border-line">
      <button type="button" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen(!advancedOpen)}
        className="flex w-full items-center justify-between py-4 text-left">
        <span className="flex items-center gap-3">
          <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-navy">Advanced Experimental Conditions</span>
          {activeCount > 0 && <span className="rounded-full bg-orange/10 px-2 py-0.5 text-[11px] font-medium text-orange">{activeCount} set</span>}
        </span>
        <ChevronDown size={16} className={`text-navy transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
      </button>
      {advancedOpen && (
        <div className="grid gap-x-8 gap-y-6 pb-6 md:grid-cols-2">
          <NumField k="oxygen_pct" label="Oxygen Concentration" unit="% O₂" />
          <NumField k="pressure_kpa" label="Atmospheric Pressure" unit="kPa" />
          <NumField k="airflow_cm_s" label="Airflow Velocity" unit="cm/s" />
          <Select k="gravity_level" label="Gravity Level" options={GRAVITY_LEVELS} />
        </div>
      )}
    </div>
  );
}
