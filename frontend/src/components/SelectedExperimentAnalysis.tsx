import { ExternalLink, FileText } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';
import { XVAR_META, type XVar } from '../lib/chartData';
import { fmtNum, measurementGroups, outcomeCounts } from '../lib/records';
import { useSearch } from '../state/SearchContext';
import { QUANTITY_LABEL, type ExperimentRecord } from '../types';
import { Orbit, SectionTitle } from './Decor';
import { axisLabel, axisProps, ChartFrame, EmptyState, TooltipBox, usePool, type PoolItem } from './Shared';

const ORANGE = '#EA8B33', GOLD = '#F3B940', TEAL = '#32667F';

type View =
  | { id: string; kind: 'xy'; title: string; groupKey: string; x: XVar; unit: string; definition: string; label: string }
  | { id: string; kind: 'per-test'; title: string; groupKey: string; unit: string; definition: string; label: string }
  | { id: string; kind: 'outcomes'; title: string }
  | { id: string; kind: 'conditions'; title: string };

function viewsFor(rec: ExperimentRecord): View[] {
  const views: View[] = [];
  for (const g of measurementGroups(rec)) {
    const key = `${g.unit}|${g.definition}`;
    const tests = rec.tests.filter((t) => t.measurements.some((m) => m.quantity === g.quantity && m.unit === g.unit && m.definition === g.definition));
    const order: XVar[] = g.quantity === 'flame_spread_rate' ? ['airflow_cm_s', 'oxygen_pct', 'pressure_kpa'] : ['oxygen_pct', 'airflow_cm_s', 'pressure_kpa'];
    const x = order.find((v) => new Set(tests.map((t) => t[v]).filter((n) => n != null)).size > 1);
    const label = QUANTITY_LABEL[g.quantity];
    views.push(x
      ? { id: `${key}|${x}`, kind: 'xy', title: `${label} vs. ${XVAR_META[x].label}`, groupKey: key, x, unit: g.unit, definition: g.definition, label }
      : { id: `${key}|test`, kind: 'per-test', title: `${label} by test run`, groupKey: key, unit: g.unit, definition: g.definition, label });
  }
  if (Object.keys(outcomeCounts(rec)).length) views.push({ id: 'outcomes', kind: 'outcomes', title: 'Experimental outcomes' });
  views.push({ id: 'conditions', kind: 'conditions', title: 'Conditions by test run' });
  return views;
}

function IndividualGraph({ item, rec }: { item: PoolItem; rec: ExperimentRecord }) {
  const views = useMemo(() => viewsFor(rec), [rec]);
  const [pick, setPick] = useState<string | null>(null);
  const [selTest, setSelTest] = useState<string | null>(null);
  const view = views.find((v) => v.id === pick) ?? views[0];

  const valueRows = (v: Extract<View, { groupKey: string }>) => rec.tests.flatMap((t) => {
    const m = t.measurements.find((mm) => `${mm.unit}|${mm.definition}` === v.groupKey);
    return m ? [{ test: t.test_identifier, test_number: t.test_number, y: m.value, x: v.kind === 'xy' ? t[v.x] : null, o2: t.oxygen_pct, p: t.pressure_kpa, u: t.airflow_cm_s, outcome: t.outcome }] : [];
  });

  let body: JSX.Element, rows: Record<string, unknown>[] = [], note = '';
  if (view.kind === 'xy' || view.kind === 'per-test') {
    const data = valueRows(view).filter((r) => view.kind !== 'xy' || r.x != null).sort((a, b) => (a.x ?? 0) - (b.x ?? 0));
    rows = data.map((d) => ({ test: d.test, ...(view.kind === 'xy' ? { [`${XVAR_META[view.x].label} (${XVAR_META[view.x].unit})`]: d.x } : {}), [`${view.label} (${view.unit})`]: d.y, outcome: d.outcome ?? '' }));
    note = `y = ${view.definition} (${view.unit}). ${data.length} of ${rec.tests.length} tests carry this measurement.`;
    const tip = ({ active, payload }: { active?: boolean; payload?: { payload: (typeof data)[number] }[] }) => {
      if (!active || !payload?.length) return null;
      const d = payload[0].payload;
      return <TooltipBox title={d.test} color={ORANGE} rows={[[view.label, `${fmtNum(d.y)} ${view.unit}`], ['O₂', d.o2 != null ? `${d.o2}%` : 'N/A'], ['Pressure', d.p != null ? `${d.p} kPa` : 'N/A'], ['Airflow', d.u != null ? `${d.u} cm/s` : 'N/A'], ['Outcome', d.outcome ?? 'N/A']]} />;
    };
    body = view.kind === 'xy' ? (
      <ResponsiveContainer width="100%" height={300}>
        <ScatterChart margin={{ top: 10, right: 16, bottom: 24, left: 12 }}>
          <CartesianGrid stroke="#EEF0F2" />
          <XAxis type="number" dataKey="x" domain={['auto', 'auto']} {...axisProps} label={axisLabel(`${XVAR_META[view.x].label} (${XVAR_META[view.x].unit})`, 'x')} />
          <YAxis type="number" dataKey="y" domain={['auto', 'auto']} {...axisProps} width={56} label={axisLabel(`${view.label} (${view.unit})`, 'y')} />
          <Tooltip content={tip as never} cursor={{ strokeDasharray: '3 3', stroke: '#C9CED4' }} />
          <Scatter data={data} line={{ stroke: ORANGE, strokeWidth: 1.5 }} isAnimationActive={false} onClick={(d) => setSelTest((d as unknown as { test: string }).test)}
            shape={(raw: unknown) => { const p = raw as { cx: number; cy: number; payload: { test: string } }; return (
              <circle cx={p.cx} cy={p.cy} r={p.payload.test === selTest ? 7 : 5} fill={p.payload.test === selTest ? GOLD : ORANGE} stroke="#132F45" strokeWidth={p.payload.test === selTest ? 1.5 : 0.75} style={{ cursor: 'pointer' }} />
            ); }} />
        </ScatterChart>
      </ResponsiveContainer>
    ) : (
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 10, right: 16, bottom: 24, left: 12 }} barCategoryGap="30%">
          <CartesianGrid stroke="#EEF0F2" vertical={false} />
          <XAxis dataKey="test" {...axisProps} label={axisLabel('Test identifier', 'x')} />
          <YAxis {...axisProps} width={56} label={axisLabel(`${view.label} (${view.unit})`, 'y')} />
          <Tooltip content={tip as never} cursor={{ fill: '#F5F6F7' }} />
          <Bar dataKey="y" radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false} onClick={(d) => setSelTest((d as unknown as { test: string }).test)}>
            {data.map((d) => <Cell key={d.test} fill={d.test === selTest ? GOLD : ORANGE} stroke="#132F45" strokeWidth={0.5} style={{ cursor: 'pointer' }} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
    if (view.kind === 'per-test') note += ' Test conditions do not vary for this measurement, so values are shown per run.';
  } else if (view.kind === 'outcomes') {
    const oc = Object.entries(outcomeCounts(rec)).map(([outcome, n]) => ({ outcome, n }));
    rows = oc;
    note = `${oc.reduce((a, r) => a + r.n, 0)} of ${rec.tests.length} tests have a recorded outcome.`;
    body = (
      <ResponsiveContainer width="100%" height={Math.max(160, oc.length * 44 + 40)}>
        <BarChart data={oc} layout="vertical" margin={{ top: 4, right: 32, bottom: 8, left: 12 }}>
          <CartesianGrid stroke="#EEF0F2" horizontal={false} />
          <XAxis type="number" allowDecimals={false} {...axisProps} />
          <YAxis type="category" dataKey="outcome" width={140} {...axisProps} />
          <Tooltip cursor={{ fill: '#F5F6F7' }} content={({ active, payload }) => active && payload?.length
            ? <TooltipBox title={String((payload[0].payload as { outcome: string }).outcome)} color={TEAL} rows={[['Tests', String(payload[0].value)], ['IDs', rec.tests.filter((t) => t.outcome === (payload[0].payload as { outcome: string }).outcome).map((t) => t.test_identifier).join(', ')]]} />
            : null} />
          <Bar dataKey="n" fill={TEAL} radius={[0, 4, 4, 0]} maxBarSize={20} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    );
  } else {
    rows = rec.tests.map((t) => ({
      test: t.test_identifier, '#': t.test_number, 'O₂ (%)': t.oxygen_pct ?? 'N/A', 'Pressure (kPa)': t.pressure_kpa ?? 'N/A', 'Airflow (cm/s)': t.airflow_cm_s ?? 'N/A',
      outcome: t.outcome ?? 'N/A', measurements: t.measurements.map((m) => `${QUANTITY_LABEL[m.quantity]} ${fmtNum(m.value)} ${m.unit}`).join('; ') || 'N/A',
    }));
    note = 'Run-by-run conditions exactly as recorded. N/A = not recorded.';
    const cols = Object.keys(rows[0] ?? {});
    body = (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-xs tnum">
          <thead className="bg-navy text-white"><tr>{cols.map((c) => <th key={c} className="px-3 py-2 font-medium">{c}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i} onClick={() => setSelTest(String(r.test))} className={`cursor-pointer border-b border-line ${selTest === r.test ? 'bg-gold/15' : 'hover:bg-faint'}`}>
              {cols.map((c) => <td key={c} className={`px-3 py-2 ${r[c] === 'N/A' ? 'text-muted/70' : ''}`}>{String(r[c])}</td>)}
            </tr>
          ))}</tbody>
        </table>
      </div>
    );
  }

  return (
    <ChartFrame title={view.title} subtitle={`Only ${item.id}'s own test records. Click a mark to highlight a test run.`} rows={rows} csvName={`${item.id}_${view.id.replace(/[^a-z0-9]+/gi, '_')}.csv`}
      controls={views.length > 1 ? views.map((v) => <button key={v.id} type="button" className="pill" aria-pressed={v.id === view.id} onClick={() => setPick(v.id)}>{v.title}</button>) : undefined}
      footnote={<><p>{note}</p><p><span className="font-medium text-navy">Source:</span> <a className="text-teal hover:underline" href={item.inv.reference_link} target="_blank" rel="noreferrer">{item.inv.psi_id}</a> · {item.id} · {item.exp.evidence.join('; ')}</p></>}>
      {body}
    </ChartFrame>
  );
}

function Block({ letter, title, accent, children }: { letter: string; title: string; accent: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-3 flex items-baseline gap-3">
        <span className="display text-sm font-light tracking-[0.3em] text-teal">{letter}</span>
        <h3 className="text-xl font-medium uppercase tracking-wide">{title}</h3>
      </div>
      <div className="mb-4 h-px w-16" style={{ background: accent }} />
      {children}
    </div>
  );
}

export function SelectedExperimentAnalysis() {
  const pool = usePool();
  const { activeId } = useSearch();
  const item = activeId ? pool.get(activeId) : undefined;

  return (
    <section id="analysis">
      <SectionTitle index="04" title="Experiment Analysis" kicker="Select an experiment from the table or a chart to change this analysis." />
      {!item ? <EmptyState title="No experiment selected" /> : (
        <div key={item.id}>
          <div className="relative mb-12">
            <Orbit className="absolute -left-6 -top-6 w-[min(560px,100%)]" w={560} h={140} tilt={-4} />
            <h2 className="relative text-[40px] font-medium uppercase leading-none sm:text-[56px]">{item.exp.experiment}</h2>
          </div>

          <div className="grid gap-12 lg:grid-cols-2">
            <Block letter="B" title="Key Findings" accent={ORANGE}>
              <p className="text-[15px] leading-relaxed tnum">{item.exp.summary_of_key_findings}</p>
              {item.exp.why_selected && <p className="mt-3 text-xs text-muted">{item.exp.why_selected}</p>}
            </Block>
            <Block letter="C" title="Scientific Interpretation" accent={TEAL}>
              <div className="border-l border-teal pl-4">
                <p className="mb-2 inline-flex rounded-full border border-teal/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-teal">AI-assisted interpretation</p>
                <p className="text-[15px] leading-relaxed">{item.exp.fire_safety_interpretation}</p>
              </div>
            </Block>
          </div>

          <div className="mt-12">
            <Block letter="D" title="Individual Graphical Representation" accent={GOLD}>
              {item.record ? <IndividualGraph item={item} rec={item.record} /> : (
                <EmptyState title="No numeric test record loaded for this experiment">
                  The search output lists tests {item.exp.tests.map((t) => t.test_identifier).join(', ')}, but no record with numeric values was returned for {item.id}.
                </EmptyState>
              )}
            </Block>
          </div>

          <div className="mt-12">
            <Block letter="E" title="Original Source" accent={ORANGE}>
              <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-[180px_1fr]">
                <dt className="label mb-0">NASA PSI ID</dt><dd>{item.inv.psi_id}</dd>
                <dt className="label mb-0">Investigation</dt><dd>{item.inv.name}</dd>
                <dt className="label mb-0">Experiment ID</dt><dd className="tnum">{item.id}</dd>
                <dt className="label mb-0">Test identifiers</dt>
                <dd className="flex flex-wrap gap-1.5">{item.exp.tests.map((t) => <span key={t.test_identifier} className="pill tnum">#{t.test_number} · {t.test_identifier}</span>)}</dd>
                <dt className="label mb-0">Source link</dt>
                <dd><a href={item.inv.reference_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-teal hover:underline">{item.inv.reference_link} <ExternalLink size={12} /></a></dd>
                <dt className="label mb-0">Evidence used</dt>
                <dd><ul className="space-y-1">{item.exp.evidence.map((e) => <li key={e} className="flex items-start gap-2"><FileText size={13} className="mt-0.5 shrink-0 text-orange" strokeWidth={1.5} />{e}</li>)}</ul></dd>
                {item.record?.sources.length ? <>
                  <dt className="label mb-0">Reports &amp; papers</dt>
                  <dd><ul className="space-y-1">{item.record.sources.map((s) => (
                    <li key={s.label} className="flex items-start gap-2"><FileText size={13} className="mt-0.5 shrink-0 text-teal" strokeWidth={1.5} />
                      <span>{s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="text-teal hover:underline">{s.label}</a> : s.label}{s.pages ? `, ${s.pages}` : ''}
                        {!s.verified && <span className="ml-1.5 text-[10px] uppercase tracking-[0.14em] text-muted">unverified</span>}</span>
                    </li>))}</ul></dd>
                </> : null}
              </dl>
            </Block>
          </div>
        </div>
      )}
    </section>
  );
}
