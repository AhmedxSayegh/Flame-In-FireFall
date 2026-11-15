import { ComparisonCharts } from './ComparisonCharts';
import { compareRows } from '../lib/engine';
import { deriveAttributes, NA, TABLE_ATTRIBUTES } from '../lib/records';
import { useSearch } from '../state/SearchContext';
import { Panel, PanelTitle } from './Decor';
import { EmptyState, SeriesDot, usePool, type PoolItem } from './Shared';

/** Scientific values come from the test record. */
export function cellValue(item: PoolItem, attribute: (typeof TABLE_ATTRIBUTES)[number]): string {
  if (attribute === 'Relevance')
    return `Investigation #${item.inv.rank} (${Math.round(item.inv.relevance_score)}/100) · experiment #${item.exp.rank}`;
  if (item.record) return deriveAttributes(item.record)[attribute] ?? NA;
  if (attribute === 'Investigation / PSI ID') return `${item.inv.name} / ${item.inv.psi_id}`;
  if (attribute === 'Test ID(s)') return item.exp.tests.map((t) => `#${t.test_number} · ${t.test_identifier}`).join(', ') || NA;
  if (attribute === 'Number of Tests') return String(item.exp.tests.length);
  return NA;
}

export function ExperimentPicker() {
  const pool = usePool();
  const { compareIds, setCompareIds } = useSearch();
  const items = [...pool.values()];
  return <div className="mb-6">
    <p className="label">Select two distinct experiments; a third is optional</p>
    <div className="grid gap-4 md:grid-cols-3">{[0,1,2].map(i => <label key={i} className="min-w-0"><span className="label">Experiment {i+1}{i===2 ? ' — optional' : ''}</span>
      <select className="field w-full" aria-label={`Experiment ${i+1}${i===2 ? ' — optional' : ''}`} title={pool.get(compareIds[i])?.exp.experiment} value={compareIds[i] ?? ''} onChange={e => { const ids=[...compareIds]; if(e.target.value) ids[i]=e.target.value; else ids.splice(i,1); setCompareIds(ids); }}>
        <option value="" disabled={i<2}>{i===2 ? 'None' : 'Select an experiment'}</option>
        {items.map(it => <option key={it.id} value={it.id} disabled={compareIds.some((id,j) => j!==i && id===it.id)}>{it.id} · {it.exp.experiment}</option>)}
      </select><p className="mt-2 break-words text-xs text-muted">{pool.get(compareIds[i])?.exp.experiment ?? (i===2 ? 'Optional' : 'Select an experiment')}</p>
    </label>)}</div>
    {compareIds.length<2 && <p role="status" className="mt-3 text-sm text-muted">Two distinct experiments are required for comparison.</p>}
  </div>;
}

export function ExperimentComparisonTable({ className = '' }: { className?: string }) {
  const pool = usePool();
  const { compareIds, activeId, setActiveId } = useSearch();
  const cols = compareIds.map((id) => pool.get(id)).filter((x): x is PoolItem => !!x);

  if (pool.size === 0) return (
    <Panel id="comparison" className={className}><PanelTitle index="03" title="Experiment Comparison" /><ExperimentPicker /><EmptyState title="No experiments available for the selected investigation" /></Panel>
  );

  const rows = TABLE_ATTRIBUTES.map((attribute) => ({ attribute, values: Object.fromEntries(cols.map((c) => [c.id, cellValue(c, attribute)])) }));

  if (cols.length < 2) return <Panel id="comparison" className={className}><PanelTitle index="03" title="Experiment Comparison" /><ExperimentPicker /><EmptyState title="Two distinct experiments are required for comparison" /></Panel>;

  // Use the backend's own comparison text only when the selection is exactly that investigation's top set.
  const invs = new Set(cols.map((c) => c.inv.psi_id));
  const own = invs.size === 1 ? cols[0].inv.top_experiments_comparison : null;
  const exact = own && own.experiment_ids.length === cols.length && own.experiment_ids.every((id) => compareIds.includes(id));
  const computed = compareRows(compareIds, rows);
  const sims = exact && own.similarities.length ? own.similarities : computed.similarities;
  const diffs = exact && own.differences.length ? own.differences : computed.differences;
  const conclusion = exact ? own!.conclusion
    : `${invs.size > 1 ? 'Cross-investigation' : 'Custom'} selection — statements computed from the table values above; no source conclusion exists for this combination. Records from different investigations keep their own PSI IDs and test identifiers.`;

  return (
    <Panel id="comparison" className={`@container ${className}`}>
      <PanelTitle index="03" title="Experiment Comparison" kicker="Independent of the analysis above. Click an experiment name to analyse it." />
      <ExperimentPicker />
      <p className="mb-3 text-xs text-muted">Light gray: matching reported values. White: differing or unavailable values. Row status is also stated with each attribute.</p>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[640px] md:min-w-0 table-fixed border-collapse text-left text-sm [overflow-wrap:anywhere]">
          <thead>
            <tr className="bg-navy text-white">
              <th scope="col" className="w-[18%] bg-navy px-4 py-3 text-[11px] font-medium uppercase tracking-[0.14em]">Attribute</th>
              {cols.map((c, i) => (
                <th key={c.id} scope="col" className={`px-4 py-3 align-top ${activeId === c.id ? 'shadow-[inset_0_-3px_0_#EA8B33]' : ''}`}>
                  <button type="button" onClick={() => setActiveId(c.id)} className="group text-left" aria-pressed={activeId === c.id}>
                    <span className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-white/70"><SeriesDot i={i} /> Experiment {i + 1}</span>
                    <span className="mt-1 block font-semibold underline-offset-2 group-hover:underline">{c.exp.experiment}</span>
                    <span className="block text-[11px] font-normal text-white/60">{c.id}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const vals = cols.map((c) => r.values[c.id]);
              const known = vals.every(v => v.trim() && !/^(N\/A|not available|unknown|not reported|unavailable)$/i.test(v.trim()) && !/unknown|not reported|not available/i.test(v));
              const matches = known && vals.every(v => v === vals[0]);
              const rowStatus = !known ? 'Unavailable / unknown' : matches ? 'Matching values' : 'Differing values';
              return (
                <tr key={r.attribute} className="border-t border-line" style={{background:matches ? "#F5F6F7" : "white"}}>
                  <th scope="row" className="w-[18%] bg-inherit px-4 py-2.5 text-xs font-medium text-navy shadow-[inset_-1px_0_0_#E6E8EB]">
                    {r.attribute}<span className="mt-1 block text-[10px] font-normal text-muted">{rowStatus}</span>
                  </th>
                  {cols.map((c) => {
                    const v = r.values[c.id];
                    return <td key={c.id} className={`px-4 py-2.5 align-top tnum ${v === NA ? 'text-muted/70' : ''}`}>{v}</td>;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,42fr)_minmax(0,58fr)] lg:items-start"><div className="divide-y divide-line border-y border-line">
        {([['Similarities', sims, 'border-teal/40'], ['Differences', diffs, 'border-amber/70']] as const).map(([title, list, cls]) => (
          <section key={title} className="py-3">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium uppercase tracking-wide">{title} <span className="text-sm font-normal text-muted">({list.length})</span></h3>
            </div>
            <ul className="mt-2 space-y-1.5 text-sm">{list.length ? list.map((s) => <li key={s} className={`border-l pl-3 ${cls}`}>{s}</li>) : <li className="text-muted">None recorded.</li>}</ul>
          </section>
        ))}
      <div className="mt-5">
        <h3 className="text-lg font-medium uppercase tracking-wide">Comparison Conclusion</h3>
        <p className="mt-2 text-sm leading-relaxed">{conclusion}</p>
        <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-muted">{exact ? `Source: ${cols[0].inv.psi_id} top_experiments_comparison` : 'Source: computed from table values'}</p>
      </div>
      </div><ComparisonCharts /></div>
    </Panel>
  );
}
