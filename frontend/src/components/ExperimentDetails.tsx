import { ChevronDown, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { deriveAttributes, measurementText } from '../lib/records';
import { type PoolItem } from './Shared';

export function Disclosure({ title, children, defaultOpen }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return <details open={defaultOpen} className="group border-t border-line py-3"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-navy">{title}<ChevronDown size={15} className="shrink-0 transition-transform group-open:rotate-180" /></summary><div className="mt-4 text-sm leading-relaxed">{children}</div></details>;
}

export function ExperimentDetails({ item }: { item: PoolItem }) {
  const [inspect, setInspect] = useState<'oxygen_pct' | 'pressure_kpa' | 'airflow_cm_s' | null>(null);
  const rec = item.record;
  const fields = [['oxygen_pct', 'Oxygen concentration', '%'], ['pressure_kpa', 'Pressure (recorded condition)', 'kPa'], ['airflow_cm_s', 'Airflow', 'cm/s']] as const;
  const attrs = rec ? deriveAttributes(rec) : {};
  return <>
    <div className="my-4 flex flex-wrap gap-2" aria-label="Inspect viewer conditions">{fields.map(([key,label,unit]) => <button key={key} className="pill condition-chip" onClick={() => setInspect(key)} disabled={!rec?.tests.some(t => t[key] != null)}>{label}: {rec ? [...new Set(rec.tests.map(t => t[key]).filter(v => v != null))].join(', ') || 'Not available' : 'Not available'} {rec?.tests.some(t => t[key] != null) ? unit : ''}</button>)}</div>
    {inspect && <section aria-label="Measurement source inspection" className="mb-6 rounded-xl border border-line p-5">
      <div className="flex items-start justify-between gap-3"><h3 className="text-xl uppercase">{fields.find(f => f[0] === inspect)?.[1]} — source inspection</h3><button className="btn-ghost" aria-label="Close source inspection" onClick={() => setInspect(null)}><X size={15} /></button></div>
      <p className="my-2 text-sm">{item.inv.psi_id} · {item.id} · Loaded dataset condition; this field alone does not establish measurement instrumentation. Contextual conditions are not independently measured test results.</p>
      <ul className="space-y-1 text-sm">{rec?.tests.map(t => <li key={t.test_identifier}>{t.test_identifier}: {t[inspect] == null ? 'Not available' : `${t[inspect]} ${fields.find(f => f[0] === inspect)?.[2]}`} · record locator: tests[{t.test_identifier}].{inspect}</li>)}</ul>
      <p className="mt-3 text-xs text-muted">Evidence locators supplied for this experiment (not necessarily specific to this field): {item.exp.evidence.join('; ') || 'Not available'}</p>
      <a className="text-sm text-teal hover:underline" href={item.inv.reference_link} target="_blank" rel="noreferrer">{item.inv.reference_link}</a>
    </section>}
    <div className="mb-8 grid gap-8 @2xl:grid-cols-2">
      <section><h3 className="mb-3 text-xl uppercase">Experimental conditions</h3><dl className="space-y-2 text-sm">{['Fuel / Material','Sample Shape / Size','Oxygen Concentration','Atmospheric Pressure','Airflow Velocity','Gravity Level'].map(k => <div key={k}><dt className="text-xs text-muted">{k === 'Atmospheric Pressure' ? 'Pressure — recorded condition / context' : k}</dt><dd>{attrs[k] || 'Not available'}</dd></div>)}</dl></section>
      <section><h3 className="mb-3 text-xl uppercase">Recorded results</h3><p className="text-sm leading-relaxed">{rec ? measurementText(rec) : 'Not available'}</p><p className="mt-3 text-sm">{attrs['Experimental Outcome'] || 'Not available'}</p><p className="mt-2 text-xs text-muted">{item.id} · Values and outcomes from loaded test records. Missing measurements are not inferred from the findings below.</p></section>
    </div>
    <Disclosure title="Measurement scope and record definitions">{rec ? measurementText(rec) : 'Not available'}<p className="mt-2">Only compatible quantity, unit and definition groups are plotted. Condition fields describe the loaded records; pressure context must not be interpreted as an instrument reading without supporting evidence.</p></Disclosure>
    <Disclosure title="All test records for this experiment"><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{['Test','Oxygen (%)','Pressure (kPa)','Airflow (cm/s)','Outcome','Measurements'].map(h => <th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{rec?.tests.map(t => <tr className="border-t border-line" key={t.test_identifier}>{[t.test_identifier,t.oxygen_pct,t.pressure_kpa,t.airflow_cm_s,t.outcome,t.measurements.map(m => `${m.value} ${m.unit} (${m.definition})`).join('; ') || null].map((v,i) => <td key={i} className="p-2 align-top">{v ?? 'Not available'}</td>)}</tr>)}</tbody></table></div></Disclosure>
  </>;
}
