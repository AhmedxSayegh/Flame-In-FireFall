import { ArrowRight, Loader2, RotateCcw } from 'lucide-react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Constellation, OrbitalSystem, Star } from '../components/Decor';
import { DataSourceBadge } from '../components/Shared';
import { AdvancedFilters, ResearchFilters, ResearchQuestionInput } from '../components/Filters';
import { formErrors, useSearch } from '../state/SearchContext';

export default function SearchPage() {
  const { apply, reset, status, error, form, setAdvancedOpen } = useSearch();
  const nav = useNavigate();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (Object.keys(formErrors(form)).length) { setAdvancedOpen(true); return; }
    if (await apply()) nav('/results');
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-white">
      <OrbitalSystem className="absolute -right-24 -top-20 hidden w-[520px] md:block" />
      <Constellation className="absolute bottom-6 left-6 w-44 opacity-90" />

      <header className="relative mx-auto max-w-5xl px-5 pt-10 sm:px-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-navy">
            <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#132F45" strokeWidth="1">
              <circle cx="12" cy="12" r="3.5" /><ellipse cx="12" cy="12" rx="10.5" ry="4" transform="rotate(-25 12 12)" />
            </svg>
            <span className="text-[11px] font-medium uppercase tracking-[0.24em]">NASA PSI · Combustion</span>
          </div>
          <DataSourceBadge />
        </div>

        <div className="relative mt-20 sm:mt-24">
          <Star size={14} className="absolute -left-1 -top-8" color="#EA8B33" />
          <Star size={9} className="absolute left-[46%] -top-5" />
          <Star size={7} className="absolute right-[24%] top-2 hidden sm:block" color="#32667F" />
          <h1 className="text-[64px] font-medium uppercase leading-[0.92] sm:text-[104px]">
            Flame in<br />Freefall
          </h1>
          <p className="mt-5 text-lg font-light text-teal sm:text-xl">Exploring Combustion and Fire Safety Beyond Earth</p>
        </div>
      </header>

      <main className="relative mx-auto max-w-5xl px-5 pb-28 pt-16 sm:px-8">
        <form onSubmit={onSubmit} noValidate className="space-y-10">
          <div className="flex items-baseline gap-3 border-b border-line pb-3">
            <span className="display text-sm font-light tracking-[0.3em] text-teal">01</span>
            <h2 className="text-2xl font-medium uppercase">Research Search &amp; Filters</h2>
          </div>

          <ResearchFilters />
          <ResearchQuestionInput />
          <AdvancedFilters />

          {error && (
            <div role="alert" className="border-l-2 border-orange pl-4 text-sm">
              <p className="font-medium text-navy">{error.message}</p>
              {error.details.length > 0 && <ul className="mt-1 list-disc pl-5 text-muted">{error.details.map((d) => <li key={d}>{d}</li>)}</ul>}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-4 pt-2">
            <button type="submit" className="btn-primary" disabled={status === 'loading'}>
              {status === 'loading' ? <Loader2 size={16} className="animate-spin" /> : null}
              {status === 'loading' ? 'Searching…' : 'Apply Filters'} {status !== 'loading' && <ArrowRight size={16} />}
            </button>
            <button type="button" className="btn-secondary" onClick={reset} disabled={status === 'loading'}><RotateCcw size={14} /> Reset</button>
          </div>
        </form>
      </main>
    </div>
  );
}
