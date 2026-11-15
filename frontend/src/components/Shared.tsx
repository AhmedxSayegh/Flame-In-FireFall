import { AlertTriangle, BarChart3, Download, Table2 } from 'lucide-react';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { DATA_SOURCE } from '../lib/api';
import { downloadCSV, SERIES_COLORS } from '../lib/chartData';
import { useSearch } from '../state/SearchContext';
import { experimentsForInvestigation } from '../state/selection';
import type { ExperimentRecord, RankedInvestigation, TopExperiment } from '../types';

export function DataSourceBadge() {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-muted">
      <span className={`h-1.5 w-1.5 rounded-full ${DATA_SOURCE === 'api' ? 'bg-teal' : 'bg-gold'}`} />
      {DATA_SOURCE === 'api' ? 'Backend API' : 'Demo fixture'}
    </span>
  );
}

export function DemoBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="flex items-start gap-3 border-y border-gold/60 bg-white py-3 text-sm">
      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-orange" strokeWidth={1.5} />
      <p><span className="font-semibold text-navy">Demo data.</span> Every value on this page comes from a synthetic fixture used to test the interface. None of it is a NASA PSI measurement. Set <code className="text-teal">VITE_DATA_SOURCE=api</code> to use backend records.</p>
    </div>
  );
}

export interface PoolItem { id: string; exp: TopExperiment; inv: RankedInvestigation; record?: ExperimentRecord }

/** Shared lookup scoped to the authoritative selected investigation. */
export function usePool() {
  const { result, investigationId } = useSearch();
  return useMemo(() => {
    const map = new Map<string, PoolItem>();
    const inv = result?.output.ranked.find(inv => inv.psi_id === investigationId);
    if (inv) for (const exp of experimentsForInvestigation(result?.output.ranked ?? [], investigationId))
        map.set(exp.experiment_id, { id: exp.experiment_id, exp, inv, record: result?.records[exp.experiment_id] });
    return map;
  }, [result, investigationId]);
}

export function seriesColor(i: number) { return SERIES_COLORS[i % SERIES_COLORS.length]; }

export function SeriesDot({ i, size = 9 }: { i: number; size?: number }) {
  return <span aria-hidden className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: seriesColor(i), boxShadow: '0 0 0 1px #132F45 inset' }} />;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line px-6 py-10 text-center">
      <svg aria-hidden width="40" height="20" viewBox="0 0 40 20" fill="none" stroke="#32667F" strokeWidth="0.8" opacity="0.6"><ellipse cx="20" cy="10" rx="18" ry="7" /><circle cx="20" cy="10" r="2.5" /></svg>
      <p className="text-sm font-medium text-navy">{title}</p>
      {children && <div className="max-w-md text-xs leading-relaxed text-muted">{children}</div>}
    </div>
  );
}

/** Chart wrapper: title, purpose, optional controls, chart ⇄ data table toggle, CSV export, footnote. */
export function ChartFrame({ title, subtitle, controls, rows, csvName, footnote, children, empty }: {
  title: string; subtitle?: string; controls?: ReactNode; rows: Record<string, unknown>[]; csvName: string;
  footnote?: ReactNode; children: ReactNode; empty?: ReactNode;
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const cols = rows.length ? Object.keys(rows[0]) : [];
  return (
    <figure className="rounded-xl border border-line bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <figcaption className="display text-xl font-medium uppercase leading-tight">{title}</figcaption>
          {subtitle && <p className="mt-1 text-xs text-muted">{subtitle}</p>}
        </div>
        {!empty && (
          <div className="flex gap-1.5">
            <button type="button" className="btn-ghost" aria-pressed={view === 'table'} onClick={() => setView(view === 'chart' ? 'table' : 'chart')}>
              {view === 'chart' ? <><Table2 size={13} /> Data</> : <><BarChart3 size={13} /> Chart</>}
            </button>
            <button type="button" className="btn-ghost" onClick={() => downloadCSV(csvName, rows)} disabled={!rows.length}><Download size={13} /> CSV</button>
          </div>
        )}
      </div>
      {controls && !empty && <div className="mt-4 flex flex-wrap gap-2">{controls}</div>}
      <div className="mt-4">
        {empty ?? (view === 'chart' ? children : (
          <div className="max-h-[320px] overflow-auto">
            <table className="w-full text-left text-xs tnum">
              <thead className="sticky top-0 bg-navy text-white"><tr>{cols.map((c) => <th key={c} className="px-3 py-2 font-medium">{c}</th>)}</tr></thead>
              <tbody>{rows.map((r, i) => <tr key={i} className="border-b border-line">{cols.map((c) => <td key={c} className="px-3 py-1.5">{String(r[c] ?? '')}</td>)}</tr>)}</tbody>
            </table>
          </div>
        ))}
      </div>
      {footnote && <div className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-muted">{footnote}</div>}
    </figure>
  );
}

export function TooltipBox({ title, color, rows }: { title: string; color?: string; rows: [string, ReactNode][] }) {
  return (
    <div className="min-w-[180px] rounded-lg border border-line bg-white px-3 py-2.5 text-xs shadow-[0_4px_16px_rgba(19,47,69,0.08)]">
      <div className="mb-1.5 flex items-center gap-2 font-semibold text-navy">
        {color && <span className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: '0 0 0 1px #132F45 inset' }} />}{title}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 tnum">
        {rows.map(([k, v]) => <Fragment key={k}><dt className="text-muted">{k}</dt><dd className="text-ink">{v}</dd></Fragment>)}
      </dl>
    </div>
  );
}

export const axisProps = {
  stroke: '#D5D9DE', tick: { fill: '#132F45', fontSize: 11 }, tickLine: false,
} as const;
export const axisLabel = (value: string, axis: 'x' | 'y') => axis === 'x'
  ? { value, position: 'insideBottom' as const, offset: -12, fill: '#132F45', fontSize: 11 }
  : { value, angle: -90, position: 'insideLeft' as const, offset: 4, fill: '#132F45', fontSize: 11, style: { textAnchor: 'middle' as const } };
