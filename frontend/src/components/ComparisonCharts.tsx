import { useMemo, useState, type ReactNode } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, ErrorBar, LabelList, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';
import {
  barData, groupsFor, outcomeDistribution, outcomeVsO2, scatterData, SERIES_SHAPES, XVAR_META, type MeasureGroup, type Pt, type XVar,
} from '../lib/chartData';
import { fmtNum } from '../lib/records';
import { useSearch } from '../state/SearchContext';
import { QUANTITY_LABEL, type ExperimentRecord, type Quantity } from '../types';
import { SectionTitle } from './Decor';
import { axisLabel, axisProps, ChartFrame, EmptyState, seriesColor, TooltipBox, usePool, type PoolItem } from './Shared';

interface Series { item: PoolItem; record: ExperimentRecord; i: number }

/** Sources cited under every chart: PSI IDs, experiment IDs and evidence fields. */
function Sources({ series, extra }: { series: Series[]; extra?: ReactNode }) {
  return (
    <>
      {extra}
      <p><span className="font-medium text-navy">Sources:</span>{' '}
        {series.map((s, k) => (
          <span key={s.item.id}>
            <a href={s.item.inv.reference_link} target="_blank" rel="noreferrer" className="text-teal underline-offset-2 hover:underline">{s.item.inv.psi_id}</a>{' '}
            {s.item.id}{s.item.exp.evidence.length ? ` (${s.item.exp.evidence.join('; ')})` : ''}{k < series.length - 1 ? ' · ' : ''}
          </span>
        ))}
      </p>
    </>
  );
}

function GroupPicker({ groups, value, onChange }: { groups: MeasureGroup[]; value: string; onChange: (k: string) => void }) {
  if (groups.length < 2) return groups[0] ? <span className="pill">Definition: {groups[0].definition} ({groups[0].unit})</span> : null;
  return (
    <>
      <span className="self-center text-[11px] uppercase tracking-[0.14em] text-muted">Definition</span>
      {groups.map((g) => (
        <button key={g.key} type="button" className="pill" aria-pressed={g.key === value} onClick={() => onChange(g.key)}>
          {g.definition} · {g.unit} <span className="text-muted">n={g.count}</span>
        </button>
      ))}
    </>
  );
}

function useGroup(series: Series[], quantity: Quantity) {
  const groups = useMemo(() => groupsFor(series.map((s) => s.record), quantity), [series, quantity]);
  const [pick, setPick] = useState<string | null>(null);
  const key = groups.find((g) => g.key === pick)?.key ?? groups[0]?.key ?? '';
  return { groups, key, group: groups.find((g) => g.key === key), setPick };
}

function MeasureScatter({ series, quantity, x, title, purpose, csv }: { series: Series[]; quantity: Quantity; x: XVar; title: string; purpose: string; csv: string }) {
  const { activeId, setActiveId } = useSearch();
  const { groups, key, group, setPick } = useGroup(series, quantity);
  const data = useMemo(() => scatterData(series.map((s) => s.record), quantity, key, x), [series, quantity, key, x]);
  const pts = data.series.flatMap((s) => s.points);
  const xm = XVAR_META[x];
  const label = QUANTITY_LABEL[quantity];
  const byExp = new Map(series.map((s) => [s.item.id, s]));
  const rows = pts.map((p) => ({ experiment_id: p.exp, test: p.test, [`${xm.label} (${xm.unit})`]: p.x, [`${label} (${group?.unit})`]: p.y, definition: group?.definition, outcome: p.outcome ?? '' }));
  const xVaries = new Set(pts.map((p) => p.x)).size > 1;

  const empty = !groups.length ? (
    <EmptyState title={`No ${label.toLowerCase()} measurements in the selected experiments`}>
      Missing for: {series.map((s) => s.item.id).join(', ')}. Values are only plotted from numeric test records, never from narrative text.
    </EmptyState>
  ) : !pts.length ? (
    <EmptyState title={`${label} recorded, but no ${xm.label.toLowerCase()} values`}>
      Tests {data.missingX.join(', ')} have {label.toLowerCase()} but no recorded {xm.label.toLowerCase()} ({xm.unit}), so they cannot be placed on this axis.
    </EmptyState>
  ) : undefined;

  return (
    <ChartFrame title={title} subtitle={purpose} rows={rows} csvName={csv} empty={empty}
      controls={<GroupPicker groups={groups} value={key} onChange={setPick} />}
      footnote={<Sources series={series} extra={group && <>
        <p>{pts.length} test{pts.length === 1 ? '' : 's'} plotted · y = {group?.definition} ({group?.unit}). Lines join tests within one experiment in order of {xm.label.toLowerCase()}; they are not fitted trends.</p>
        {!xVaries && pts.length > 0 && <p>All plotted tests share one {xm.label.toLowerCase()} value ({fmtNum(pts[0].x)} {xm.unit}), so this view shows test-to-test scatter only, not a dependence on {xm.label.toLowerCase()}.</p>}
        {data.noData.length > 0 && <p>No value with this definition: {data.noData.join(', ')}.</p>}
        {data.missingX.length > 0 && <p>Excluded (no {xm.label.toLowerCase()} recorded): {data.missingX.join(', ')}.</p>}
      </>} />}>
      <ResponsiveContainer width="100%" height={320}>
        <ScatterChart margin={{ top: 10, right: 16, bottom: 24, left: 12 }}>
          <CartesianGrid stroke="#EEF0F2" />
          <XAxis type="number" dataKey="x" name={xm.label} domain={['auto', 'auto']} {...axisProps} label={axisLabel(`${xm.label} (${xm.unit})`, 'x')} />
          <YAxis type="number" dataKey="y" name={label} domain={['auto', 'auto']} {...axisProps} width={56} label={axisLabel(`${label} (${group?.unit})`, 'y')} />
          <Tooltip cursor={{ stroke: '#C9CED4', strokeDasharray: '3 3' }} content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as Pt; const s = byExp.get(p.exp)!;
            return <TooltipBox title={p.test} color={seriesColor(s.i)} rows={[
              ['Experiment', p.exp], [label, `${fmtNum(p.y)} ${group?.unit}`], [xm.label, `${fmtNum(p.x)} ${xm.unit}`],
              ['O₂ / p', `${p.o2 ?? 'N/A'}% · ${p.p ?? 'N/A'} kPa`], ['Outcome', p.outcome ?? 'N/A'], ['Source', s.item.inv.psi_id],
            ]} />;
          }} />
          {data.series.map((sr) => {
            const s = byExp.get(sr.exp)!; const active = activeId === sr.exp;
            return (
              <Scatter key={sr.exp} name={s.item.exp.experiment} data={sr.points} fill={seriesColor(s.i)} shape={SERIES_SHAPES[s.i]}
                stroke="#132F45" strokeWidth={active ? 1.5 : 0.75} line={new Set(sr.points.map((p) => p.x)).size > 1 ? { stroke: seriesColor(s.i), strokeWidth: active ? 2 : 1.25 } : false}
                isAnimationActive={false} onClick={() => setActiveId(sr.exp)} style={{ cursor: 'pointer' }} />
            );
          })}
        </ScatterChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function FuelBars({ series }: { series: Series[] }) {
  const { setActiveId } = useSearch();
  const { groups, key, group, setPick } = useGroup(series, 'burning_rate');
  const rows = useMemo(() => barData(series.map((s) => s.record), 'burning_rate', key), [series, key]);
  const color = new Map(series.map((s) => [s.item.id, seriesColor(s.i)]));
  const data = rows.map((r) => ({ ...r, name: `${r.label}\n${r.exp}` }));
  const empty = !rows.length ? <EmptyState title="No burning-rate measurements in the selected experiments">Missing for: {series.map((s) => s.item.id).join(', ')}.</EmptyState> : undefined;
  return (
    <ChartFrame title="Fuel Type vs. Burning Rate" subtitle="Mean per experiment; whiskers span the minimum–maximum test value. Only one burning-rate definition is shown at a time."
      rows={rows.map((r) => ({ experiment_id: r.exp, fuel: r.label, [`mean (${group?.unit})`]: +r.mean.toFixed(4), min: r.min, max: r.max, n: r.n, tests: r.tests.join(' ') }))}
      csvName="fuel_vs_burning_rate.csv" empty={empty}
      controls={<GroupPicker groups={groups} value={key} onChange={setPick} />}
      footnote={<Sources series={series} extra={group && <p>y = {group.definition} ({group.unit}). Experiments without this definition are omitted rather than converted.</p>} />}>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} margin={{ top: 22, right: 16, bottom: 24, left: 12 }} barCategoryGap="35%">
          <CartesianGrid stroke="#EEF0F2" vertical={false} />
          <XAxis dataKey="label" {...axisProps} interval={0} label={axisLabel('Fuel / material', 'x')} />
          <YAxis {...axisProps} width={56} label={axisLabel(`Burning rate (${group?.unit})`, 'y')} />
          <Tooltip cursor={{ fill: '#F5F6F7' }} content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const r = payload[0].payload as (typeof data)[number];
            return <TooltipBox title={r.label} color={color.get(r.exp)} rows={[['Experiment', r.exp], ['Mean', `${fmtNum(r.mean)} ${group?.unit}`], ['Range', `${fmtNum(r.min)}–${fmtNum(r.max)}`], ['n', r.n], ['Tests', r.tests.join(', ')]]} />;
          }} />
          <Bar dataKey="mean" radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false} onClick={(d) => setActiveId((d as unknown as { exp: string }).exp)} style={{ cursor: 'pointer' }}>
            {data.map((r) => <Cell key={r.exp} fill={color.get(r.exp)} stroke="#132F45" strokeWidth={0.5} />)}
            <ErrorBar dataKey="err" width={8} stroke="#132F45" strokeWidth={1} />
            <LabelList dataKey="n" position="top" offset={14} formatter={(n: number) => `n=${n}`} style={{ fill: '#6B7178', fontSize: 10 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function ExtinctionPlot({ series }: { series: Series[] }) {
  const { setActiveId } = useSearch();
  const { series: data, categories } = useMemo(() => outcomeVsO2(series.map((s) => s.record)), [series]);
  const byExp = new Map(series.map((s) => [s.item.id, s]));
  const pts = data.flatMap((d) => d.points);
  const idx = (c: string) => categories.indexOf(c);
  const empty = !pts.length ? <EmptyState title="No tests with both a recorded outcome and an oxygen value" /> : undefined;
  return (
    <ChartFrame title="Oxygen Concentration vs. Extinction Outcome" subtitle="Recorded outcome per test, as categories. Mark size = number of tests with the same O₂ and outcome; series are nudged vertically so overlapping marks stay visible."
      rows={pts.map((p) => ({ experiment_id: p.exp, 'O₂ (%)': p.x, outcome: p.y, tests: p.n, test_ids: p.tests.join(' ') }))} csvName="oxygen_vs_outcome.csv" empty={empty}
      footnote={<Sources series={series} extra={<p>Outcome labels are shown exactly as recorded; categories are not converted to numbers.</p>} />}>
      <ResponsiveContainer width="100%" height={Math.max(220, categories.length * 56 + 80)}>
        <ScatterChart margin={{ top: 10, right: 16, bottom: 24, left: 12 }}>
          <CartesianGrid stroke="#EEF0F2" />
          <XAxis type="number" dataKey="x" domain={['auto', 'auto']} {...axisProps} label={axisLabel('Oxygen concentration (% O₂)', 'x')} />
          <YAxis type="number" dataKey="yi" domain={[-0.5, categories.length - 0.5]} ticks={categories.map((_, i) => i)} tickFormatter={(i: number) => categories[i] ?? ''} {...axisProps} width={128} />
          <ZAxis type="number" dataKey="n" range={[70, 300]} />
          <Tooltip content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as (typeof pts)[number]; const s = byExp.get(p.exp)!;
            return <TooltipBox title={p.y} color={seriesColor(s.i)} rows={[['Experiment', p.exp], ['O₂', `${p.x}%`], ['Tests', `${p.n}: ${p.tests.join(', ')}`], ['Source', s.item.inv.psi_id]]} />;
          }} />
          {data.map((d) => {
            const s = byExp.get(d.exp)!;
            return <Scatter key={d.exp} data={d.points.map((p) => ({ ...p, yi: idx(p.y) + (s.i - 1) * 0.12 }))} fill={seriesColor(s.i)} shape={SERIES_SHAPES[s.i]}
              stroke="#132F45" strokeWidth={0.75} fillOpacity={0.9} isAnimationActive={false} onClick={() => setActiveId(d.exp)} style={{ cursor: 'pointer' }} />;
          })}
        </ScatterChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function OutcomeDistribution({ series }: { series: Series[] }) {
  const { rows, unrecorded } = useMemo(() => outcomeDistribution(series.map((s) => s.record)), [series]);
  const empty = !rows.length ? <EmptyState title="No recorded test outcomes in the selected experiments" /> : undefined;
  return (
    <ChartFrame title="Test Outcome Distribution" subtitle="Count of tests per recorded outcome, by experiment."
      rows={rows} csvName="outcome_distribution.csv" empty={empty}
      footnote={<Sources series={series} extra={unrecorded.length ? <p>No outcome recorded: {unrecorded.join(', ')}.</p> : undefined} />}>
      <ResponsiveContainer width="100%" height={Math.max(200, rows.length * (series.length * 18 + 22) + 40)}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 32, bottom: 8, left: 12 }} barGap={2} barCategoryGap="22%">
          <CartesianGrid stroke="#EEF0F2" horizontal={false} />
          <XAxis type="number" allowDecimals={false} {...axisProps} />
          <YAxis type="category" dataKey="outcome" {...axisProps} width={140} />
          <Tooltip cursor={{ fill: '#F5F6F7' }} content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            return <TooltipBox title={String(label)} rows={payload.map((p) => [String(p.dataKey), `${p.value} test${p.value === 1 ? '' : 's'}`] as [string, string])} />;
          }} />
          {series.map((s) => (
            <Bar key={s.item.id} dataKey={s.item.id} fill={seriesColor(s.i)} stroke="#132F45" strokeWidth={0.5} radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={false}>
              <LabelList dataKey={s.item.id} position="right" style={{ fill: '#2A2D31', fontSize: 10 }} formatter={(v: number) => (v ? v : '')} />
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function ComparisonCharts() {
  const pool = usePool();
  const { compareIds, activeId, setActiveId } = useSearch();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const all = compareIds.map((id, i) => ({ item: pool.get(id)!, i })).filter((x) => x.item);
  const noRecord = all.filter((x) => !x.item.record).map((x) => x.item.id);
  const series: Series[] = useMemo(
    () => all.filter((x) => x.item.record && !hidden.has(x.item.id)).map((x) => ({ item: x.item, record: x.item.record!, i: x.i })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [compareIds.join(), hidden, pool],
  );
  const toggle = (id: string) => setHidden((h) => { const n = new Set(h); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <section id="charts">
      <SectionTitle index="03" title="Graphical Comparison" kicker="Each point is one recorded test. Hover for test details; click a mark to open that experiment's analysis." />
      <div className="mb-6 flex flex-wrap items-center gap-2" role="group" aria-label="Toggle experiment series">
        <span className="mr-1 text-[11px] uppercase tracking-[0.14em] text-muted">Series</span>
        {all.map(({ item, i }) => (
          <button key={item.id} type="button" className="pill" aria-pressed={!hidden.has(item.id)} onClick={() => toggle(item.id)}
            onDoubleClick={() => setActiveId(item.id)} style={{ opacity: hidden.has(item.id) ? 0.5 : 1 }}>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
              {i === 0 && <circle cx="6" cy="6" r="4.5" fill={seriesColor(i)} stroke="#132F45" strokeWidth="0.75" />}
              {i === 1 && <rect x="1.5" y="1.5" width="9" height="9" fill={seriesColor(i)} stroke="#132F45" strokeWidth="0.75" />}
              {i === 2 && <path d="M6 1.5 L10.5 10.5 L1.5 10.5Z" fill={seriesColor(i)} stroke="#132F45" strokeWidth="0.75" />}
            </svg>
            <span className={activeId === item.id ? 'font-semibold text-navy' : ''}>{item.exp.experiment}</span>
            <span className="text-muted">{item.inv.psi_id}</span>
          </button>
        ))}
      </div>
      {noRecord.length > 0 && (
        <p className="mb-4 text-xs text-muted">No numeric test record loaded for {noRecord.join(', ')}; these experiments appear in the table but not in charts.</p>
      )}
      {series.length === 0 ? <EmptyState title="No series to plot">Turn on at least one experiment series with a numeric record.</EmptyState> : (
        <div className="grid gap-6 xl:grid-cols-2">
          <MeasureScatter series={series} quantity="burning_rate" x="oxygen_pct" title="Oxygen Concentration vs. Burning Rate" purpose="How measured burning rate varies with ambient oxygen." csv="oxygen_vs_burning_rate.csv" />
          <MeasureScatter series={series} quantity="flame_spread_rate" x="airflow_cm_s" title="Airflow Velocity vs. Flame Spread Rate" purpose="How flame propagation changes with imposed airflow." csv="airflow_vs_flame_spread.csv" />
          <FuelBars series={series} />
          <ExtinctionPlot series={series} />
          <div className="xl:col-span-2"><OutcomeDistribution series={series} /></div>
        </div>
      )}
    </section>
  );
}
