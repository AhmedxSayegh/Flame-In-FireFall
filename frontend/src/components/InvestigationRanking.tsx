import { Check, ChevronDown, CircleDashed, ExternalLink, Minus, X } from 'lucide-react';
import { useState } from 'react';
import { FIELD_LABEL } from '../lib/engine';
import { parseMatch } from '../lib/schema';
import type { FieldMatchKey, MatchLevel, RankedInvestigation } from '../types';
import { Panel, PanelTitle } from './Decor';
import { useSearch } from '../state/SearchContext';
import { EmptyState } from './Shared';

export function strength(score: number) {
  return score >= 75 ? { label: 'Strong Match', color: '#EA8B33' } : score >= 50 ? { label: 'Moderate Match', color: '#EEA23A' } : { label: 'Weak Match', color: '#32667F' };
}

const GROUPS: { level: MatchLevel; title: string; Icon: typeof Check; cls: string }[] = [
  { level: 'match', title: 'Matches', Icon: Check, cls: 'text-orange' },
  { level: 'partial', title: 'Partial', Icon: Minus, cls: 'text-amber' },
  { level: 'unknown', title: 'Unknown', Icon: CircleDashed, cls: 'text-muted' },
  { level: 'no match', title: 'No Match', Icon: X, cls: 'text-teal' },
];

function InvestigationCard({ inv }: { inv: RankedInvestigation }) {
  const { investigationId, selectInvestigation } = useSearch();
  const [open, setOpen] = useState(false);
  const selected = investigationId === inv.psi_id;
  const s = strength(inv.relevance_score);
  const entries = Object.entries(inv.field_matches) as [FieldMatchKey, string][];
  const byLevel = (lvl: MatchLevel) => entries.map(([k, v]) => ({ k, ...parseMatch(v) })).filter((e) => e.level === lvl);
  const count = (lvl: MatchLevel) => byLevel(lvl).length;
  const summary = entries.length === 0 ? 'No active filters — listed unranked.'
    : [`${count('match')} of ${entries.length} filters match`, count('partial') && `${count('partial')} partial`, count('unknown') && `${count('unknown')} unknown`, count('no match') && `${count('no match')} no match`].filter(Boolean).join(' · ');

  return (
    <article className={`rounded-xl border bg-white transition-colors ${selected ? 'border-orange shadow-[inset_3px_0_0_#EA8B33]' : 'border-line hover:border-[#C9CED4]'}`}>
      <button type="button" onClick={() => selectInvestigation(inv.psi_id)} aria-pressed={selected}
        className="grid w-full grid-cols-[auto_1fr_auto] items-start gap-x-4 rounded-xl p-4 text-left">
        <span className="display text-[40px] font-light leading-none text-navy"><span className="align-top text-base text-teal">#</span>{inv.rank}</span>
        <span className="min-w-0">
          <span className="block text-[11px] font-medium uppercase tracking-[0.18em] text-teal">{inv.psi_id}</span>
          <span className="display mt-0.5 block text-lg font-medium uppercase leading-tight text-navy">{inv.name}</span>
          <span className="mt-1 block text-xs text-muted">{summary}</span>
        </span>
        <span className="text-right">
          <span className="display block text-[32px] font-medium leading-none tnum text-navy">{Math.round(inv.relevance_score)}<span className="text-xs font-normal text-muted">/100</span></span>
          <span className="mt-1 block whitespace-nowrap text-[10px] font-medium uppercase tracking-[0.12em] text-navy">
            <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: s.color }} />{s.label}
          </span>
        </span>
        <span className="col-span-3 mt-3 block h-1 w-full overflow-hidden rounded-full bg-faint" role="meter" aria-valuenow={inv.relevance_score} aria-valuemin={0} aria-valuemax={100} aria-label="Relevance score">
          <span className="block h-full rounded-full" style={{ width: `${inv.relevance_score}%`, background: s.color }} />
        </span>
      </button>
      <div className="border-t border-line">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.14em] text-navy">
          Match details &amp; scoring <ChevronDown size={14} className={open ? 'rotate-180' : ''} />
        </button>
        {open && (
          <div className="space-y-3 px-4 pb-4 text-sm leading-relaxed">
            {entries.length > 0 && (
              <dl className="space-y-2">
                {GROUPS.map(({ level, title, Icon, cls }) => {
                  const items = byLevel(level);
                  if (!items.length) return null;
                  return (
                    <div key={level}>
                      <dt className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] ${cls}`}><Icon size={12} strokeWidth={2} />{title}</dt>
                      <dd className="mt-0.5 text-ink">
                        {items.map((it, i) => (
                          <span key={it.k}>{FIELD_LABEL[it.k]}{it.reason && <span className="text-muted"> — {it.reason}</span>}{i < items.length - 1 ? '; ' : ''}</span>
                        ))}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            )}
            <div className="border-t border-line pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-teal">How this score was calculated</p>
              <p className="mt-0.5 tnum">{inv.score_method ?? 'The backend did not provide a score method for this investigation.'}</p>
              <p className="mt-1 text-muted">Top experiments: {inv.top_experiments.map((e) => e.experiment_id).join(', ') || 'none'}{inv.runner_up ? ` · Runner-up: ${inv.runner_up}` : ''}</p>
            </div>
            <a href={inv.reference_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-teal underline-offset-2 hover:underline">
              Source record <ExternalLink size={11} />
            </a>
          </div>
        )}
      </div>
    </article>
  );
}

export function InvestigationRanking({ ranked, className = '' }: { ranked: RankedInvestigation[]; className?: string }) {
  return (
    <Panel id="ranking" className={className}>
      <PanelTitle index="01" title="Investigation Ranking"
        kicker="Relevance to your filters, out of 100 — not fire risk or scientific certainty. Select an investigation to analyse its experiments." />
      {ranked.length === 0
        ? <EmptyState title="No investigations to rank">No loaded records match the selected investigation. See Research Gaps & Limitations.</EmptyState>
        : <div className="space-y-3">{ranked.map((inv) => <InvestigationCard key={inv.psi_id} inv={inv} />)}</div>}
    </Panel>
  );
}
