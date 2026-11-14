import { Check, ChevronDown, CircleDashed, ExternalLink, Minus, X } from 'lucide-react';
import { useState } from 'react';
import { parseMatch } from '../lib/schema';
import { FIELD_LABEL, type FieldMatchKey, type MatchLevel, type RankedInvestigation } from '../types';
import { SectionTitle } from './Decor';
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
  const [open, setOpen] = useState(inv.rank === 1);
  const s = strength(inv.relevance_score);
  const entries = Object.entries(inv.field_matches) as [FieldMatchKey, string][];
  const byLevel = (lvl: MatchLevel) => entries.map(([k, v]) => ({ k, ...parseMatch(v) })).filter((e) => e.level === lvl);

  return (
    <article className="rounded-xl border border-line bg-white">
      <div className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-4 p-5 sm:grid-cols-[auto_1fr_auto] sm:p-6">
        <div className="display row-span-2 text-[56px] font-light leading-none text-navy sm:text-[72px]">
          <span className="text-2xl align-top text-teal">#</span>{inv.rank}
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-teal">{inv.psi_id}</p>
          <h3 className="mt-0.5 text-2xl font-medium uppercase leading-tight">{inv.name}</h3>
          <a href={inv.reference_link} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-teal underline-offset-2 hover:underline">
            Source record <ExternalLink size={11} />
          </a>
        </div>
        <div className="col-span-2 sm:col-span-1 sm:row-span-2 sm:w-56 sm:text-right">
          <div className="flex items-baseline gap-1 sm:justify-end">
            <span className="display text-5xl font-medium tnum text-navy">{Math.round(inv.relevance_score)}</span>
            <span className="text-sm text-muted">/100</span>
          </div>
          <p className="mt-0.5 text-xs font-medium uppercase tracking-[0.14em]" style={{ color: s.color === '#32667F' ? '#32667F' : '#132F45' }}>
            <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: s.color }} />{s.label}
          </p>
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-faint" role="meter" aria-valuenow={inv.relevance_score} aria-valuemin={0} aria-valuemax={100} aria-label="Relevance score">
            <div className="h-full rounded-full" style={{ width: `${inv.relevance_score}%`, background: s.color }} />
          </div>
        </div>
        <div className="col-span-2 sm:col-span-1">
          {entries.length === 0 ? <p className="text-sm text-muted">No active filters — all investigations are listed unranked.</p> : (
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
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
        </div>
      </div>
      <div className="border-t border-line">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between px-5 py-3 text-xs font-medium uppercase tracking-[0.14em] text-navy sm:px-6">
          How this score was calculated <ChevronDown size={14} className={open ? 'rotate-180' : ''} />
        </button>
        {open && (
          <div className="space-y-2 px-5 pb-5 text-sm leading-relaxed sm:px-6">
            <p className="tnum">{inv.score_method ?? 'The backend did not provide a score method for this investigation.'}</p>
            <p className="text-muted">Top experiments: {inv.top_experiments.map((e) => e.experiment_id).join(', ') || 'none'}{inv.runner_up ? ` · Runner-up: ${inv.runner_up}` : ''}</p>
          </div>
        )}
      </div>
    </article>
  );
}

export function InvestigationRanking({ ranked }: { ranked: RankedInvestigation[] }) {
  return (
    <section id="ranking">
      <SectionTitle index="01" title="Investigation Ranking" orbit
        kicker="Relevance to your filters, out of 100. A score reflects research relevance — not fire risk or scientific certainty." />
      {ranked.length === 0
        ? <EmptyState title="No investigations to rank">No loaded records match the selected investigation. See Research Gaps below.</EmptyState>
        : <div className="space-y-5">{ranked.map((inv) => <InvestigationCard key={inv.psi_id} inv={inv} />)}</div>}
    </section>
  );
}
