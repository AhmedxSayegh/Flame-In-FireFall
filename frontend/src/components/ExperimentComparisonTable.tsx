import { compareRows } from '../lib/compare';
import { ATTRIBUTE_ALIASES, deriveAttributes, NA, TABLE_ATTRIBUTES } from '../lib/records';
import { useSearch } from '../state/SearchContext';
import { SectionTitle } from './Decor';
import { EmptyState, SeriesDot, usePool, type PoolItem } from './Shared';

/** Value for one cell: backend compared_on first, then the numeric record, else N/A. */
export function cellValue(item: PoolItem, attribute: (typeof TABLE_ATTRIBUTES)[number]): string {
  if (attribute === 'Relevance')
    return `Investigation #${item.inv.rank} (${Math.round(item.inv.relevance_score)}/100) · experiment #${item.exp.rank}`;
  for (const row of item.inv.top_experiments_comparison.compared_on) {
    const mapped = ATTRIBUTE_ALIASES[row.attribute.toLowerCase()] ?? row.attribute;
    if (mapped === attribute && row.values[item.id]) return row.values[item.id];
  }
  if (item.record) return deriveAttributes(item.record)[attribute] ?? NA;
  if (attribute === 'Investigation / PSI ID') return `${item.inv.name} / ${item.inv.psi_id}`;
  if (attribute === 'Test ID(s)') return item.exp.tests.map((t) => t.test_identifier).join(', ') || NA;
  if (attribute === 'Number of Tests') return String(item.exp.tests.length);
  return NA;
}

export function ExperimentPicker() {
  const pool = usePool();
  const { compareIds, setCompareIds, activeId } = useSearch();
  const items = [...pool.values()];
  const toggle = (id: string) => {
    if (compareIds.includes(id)) { if (compareIds.length > 2) setCompareIds(compareIds.filter((x) => x !== id)); }
    else if (compareIds.length < 3) setCompareIds([...compareIds, id]);
  };
  return (
    <div className="mb-6">
      <p className="label">Select 2–3 experiments to compare <span className="normal-case tracking-normal text-muted">({compareIds.length}/3 selected)</span></p>
      <div className="flex flex-wrap gap-2">
        {items.map((it) => {
          const on = compareIds.includes(it.id);
          const blocked = !on && compareIds.length >= 3;
          return (
            <button key={it.id} type="button" aria-pressed={on} disabled={blocked} onClick={() => toggle(it.id)}
              title={blocked ? 'Deselect one experiment first (max 3)' : it.exp.experiment}
              className={`pill ${blocked ? 'opacity-40' : ''} ${activeId === it.id ? 'font-semibold' : ''}`}>
              {on && <SeriesDot i={compareIds.indexOf(it.id)} size={8} />}
              <span className="text-teal">{it.inv.psi_id}</span> {it.exp.experiment}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ExperimentComparisonTable() {
  const pool = usePool();
  const { compareIds, activeId, setActiveId } = useSearch();
  const cols = compareIds.map((id) => pool.get(id)).filter((x): x is PoolItem => !!x);

  if (pool.size === 0) return (
    <section id="comparison"><SectionTitle index="02" title="Experiment Comparison" /><EmptyState title="No experiments returned for this search" /></section>
  );

  const rows = TABLE_ATTRIBUTES.map((attribute) => ({ attribute, values: Object.fromEntries(cols.map((c) => [c.id, cellValue(c, attribute)])) }));

  // Use the backend's own comparison text only when the selection is exactly that investigation's top set.
  const invs = new Set(cols.map((c) => c.inv.psi_id));
  const own = invs.size === 1 ? cols[0].inv.top_experiments_comparison : null;
  const exact = own && own.experiment_ids.length === cols.length && own.experiment_ids.every((id) => compareIds.includes(id));
  const computed = compareRows(compareIds, rows);
  const sims = exact ? own!.similarities : computed.similarities;
  const diffs = exact ? own!.differences : computed.differences;
  const conclusion = exact ? own!.conclusion
    : `${invs.size > 1 ? 'Cross-investigation' : 'Custom'} selection — statements computed from the table values above; no source conclusion exists for this combination. Records from different investigations keep their own PSI IDs and test identifiers.`;

  return (
    <section id="comparison">
      <SectionTitle index="02" title="Experiment Comparison" kicker="Click an experiment name to open its analysis below. Rows marked ◆ differ across the selection." />
      <ExperimentPicker />
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead>
            <tr className="bg-navy text-white">
              <th scope="col" className="w-48 px-4 py-3 text-[11px] font-medium uppercase tracking-[0.14em]">Attribute</th>
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
              const differs = !['Test ID(s)', 'Relevance'].includes(r.attribute) && vals.some((v) => v !== vals[0]) && !vals.every((v) => v === NA);
              return (
                <tr key={r.attribute} className="border-t border-line">
                  <th scope="row" className="px-4 py-2.5 text-xs font-medium text-navy">
                    {r.attribute}{differs && <span className="ml-1.5 text-amber" title="Differs across experiments">◆</span>}
                  </th>
                  {cols.map((c) => {
                    const v = r.values[c.id];
                    return <td key={c.id} className={`px-4 py-2.5 align-top tnum ${activeId === c.id ? 'bg-orange/[0.04]' : ''} ${v === NA ? 'text-muted/70' : ''}`}>{v}</td>;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-8 grid gap-8 md:grid-cols-2">
        <div>
          <h3 className="text-lg font-medium uppercase tracking-wide">Similarities</h3>
          <ul className="mt-2 space-y-1.5 text-sm">{sims.length ? sims.map((s) => <li key={s} className="border-l border-teal/40 pl-3">{s}</li>) : <li className="text-muted">None recorded.</li>}</ul>
        </div>
        <div>
          <h3 className="text-lg font-medium uppercase tracking-wide">Differences</h3>
          <ul className="mt-2 space-y-1.5 text-sm">{diffs.length ? diffs.map((s) => <li key={s} className="border-l border-amber/70 pl-3">{s}</li>) : <li className="text-muted">None recorded.</li>}</ul>
        </div>
      </div>
      <div className="mt-8 border-t border-line pt-5">
        <h3 className="text-lg font-medium uppercase tracking-wide">Comparison Conclusion</h3>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed">{conclusion}</p>
        <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-muted">{exact ? `Source: ${cols[0].inv.psi_id} top_experiments_comparison` : 'Source: computed from table values'}</p>
      </div>
    </section>
  );
}
