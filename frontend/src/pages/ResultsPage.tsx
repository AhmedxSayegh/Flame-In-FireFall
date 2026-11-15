import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Constellation, Orbit, Star } from '../components/Decor';
import { ExperimentComparisonTable } from '../components/ExperimentComparisonTable';
import { ResearchGaps, SupportingSources } from '../components/GapsAndSources';
import { InvestigationRanking } from '../components/InvestigationRanking';
import { SelectedExperimentAnalysis, SelectedExperimentEvidence } from '../components/SelectedExperimentAnalysis';
import { DataSourceBadge, DemoBanner, SavedExampleBanner, RunInfo } from '../components/Shared';
import { useSearch, type FormState } from '../state/SearchContext';

/** Desktop: each Part 1 panel scrolls on its own inside a practical max height. */
const PANEL_MAX = 'lg:max-h-[min(1100px,calc(100vh-32px))] lg:overflow-y-auto';

const CHIP_LABEL: Partial<Record<keyof FormState, string>> = {
  crew_environment: 'Environment', fire_safety_category: 'Category', research_topic: 'Topic', investigation: 'Investigation',
  fuel_type: 'Fuel', measurement_type: 'Measurement', oxygen_pct: 'O₂ %', pressure_kpa: 'kPa', airflow_cm_s: 'cm/s', gravity_level: 'Gravity',
};

export default function ResultsPage() {
  const { result, submittedForm, investigationId, selectInvestigation } = useSearch();
  const nav = useNavigate();
  const [tab, setTab] = useState('Experiment');
  if (!result || !submittedForm) return <Navigate to="/" replace />;
  const { output, meta, records } = result;
  const isDemo = Object.values(records).some((r) => r.demo);
  const { conditions, ...filters } = output.query;
  const chips = (Object.entries({ ...filters, ...conditions, gravity_level: conditions?.gravity }) as [keyof FormState, string | number | null][])
    .filter(([key, value]) => CHIP_LABEL[key] && value != null && !(typeof value === 'string' && value.startsWith('All')));

  return (
    <div className="relative min-h-screen overflow-hidden bg-white">
      <Orbit className="absolute -right-20 top-4 hidden w-[520px] md:block" w={520} h={180} tilt={-14} />
      <header className="relative mx-auto max-w-[1560px] px-5 pt-8 sm:px-8">
        <div className="flex items-center justify-between gap-4">
          <button type="button" onClick={() => nav('/')} className="btn-ghost"><ArrowLeft size={13} /> Back to Filters</button>
          <DataSourceBadge />
        </div>
        <div className="relative mt-10">
          <Star size={12} className="absolute -top-6 left-0" color="#EA8B33" />
          <Star size={8} className="absolute -top-3 left-[38%]" />
          <h1 className="text-[48px] font-medium uppercase leading-none sm:text-[68px]">Research Results</h1>
          <p className="mt-2 text-lg font-light text-teal">NASA PSI Combustion Experiment Analysis</p>
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-2 border-y border-line py-3 text-xs" aria-label="Active result filters">
          <span className="label mb-0 mr-1">Active filters</span>
          {chips.length === 0 ? <span className="text-muted">All loaded investigations</span> : chips.map(([k, value]) => (
            <span key={k} className="pill"><span className="text-muted">{CHIP_LABEL[k]}</span> {value}</span>
          ))}
        </div>
        <DemoBanner show={isDemo} />
        <SavedExampleBanner meta={meta} />
        <RunInfo meta={meta} />
        {result.warnings.length > 0 && <div role="status" className="mt-4 border-l-2 border-orange pl-4 text-sm"><p className="font-medium text-navy">Numeric record availability</p><ul className="mt-1 list-disc pl-5 text-muted">{result.warnings.map((warning,i) => <li key={i}>{warning}</li>)}</ul></div>}
      </header>

      <main className="relative mx-auto max-w-[1560px] px-5 pb-24 pt-5 sm:px-8">
        <div role="tablist" aria-label="Results workspace" className="workspace-nav mb-6 mx-auto flex w-fit max-w-full">
          <span aria-hidden="true" className="workspace-indicator" style={{transform:`translateX(${['Experiment','Comparison','Evidence'].indexOf(tab)*100}%)`}} />
          {['Experiment','Comparison','Evidence'].map((name,i) => <button key={name} id={`workspace-tab-${name}`} role="tab" aria-selected={tab === name} aria-controls={`workspace-${name}`} tabIndex={tab === name ? 0 : -1} className="workspace-tab" onClick={() => setTab(name)} onKeyDown={e => { const names=['Experiment','Comparison','Evidence']; const n=e.key === 'ArrowRight' ? (i+1)%3 : e.key === 'ArrowLeft' ? (i+2)%3 : e.key === 'Home' ? 0 : e.key === 'End' ? 2 : -1; if(n>=0) { e.preventDefault(); setTab(names[n]); document.getElementById(`workspace-tab-${names[n]}`)?.focus(); } }}>{name}</button>)}
        </div>
        {tab !== 'Experiment' && <div role="group" aria-label="Select investigation" className="mb-6 flex flex-wrap items-center gap-2">
          <span className="label mb-0 mr-2">Investigation</span>
          {output.ranked.map(inv => <button key={inv.psi_id} type="button" className="pill transition-colors hover:border-orange"
            aria-pressed={investigationId === inv.psi_id} onClick={() => selectInvestigation(inv.psi_id)}>
            {inv.name} <span className="text-muted">{inv.psi_id}</span>
          </button>)}
          {output.ranked.length === 0 && <span className="text-xs text-muted">No investigations returned.</span>}
        </div>}
        <div id="workspace-Experiment" role="tabpanel" aria-labelledby="workspace-tab-Experiment" style={{display:tab === 'Experiment' ? undefined : 'none'}}>
        {/* PART 1 — ranking + analysis of the selected investigation */}
        <PartLabel n="Part 1" title="Investigations & Experiment Analysis" />
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,39fr)_minmax(0,61fr)]">
          <InvestigationRanking ranked={output.ranked} className={PANEL_MAX} />
          <SelectedExperimentAnalysis className={PANEL_MAX} onViewEvidence={() => {setTab('Evidence'); requestAnimationFrame(() => document.getElementById('selected-evidence')?.scrollIntoView({block:'start'}));}} />
        </div>

        </div>
        <div id="workspace-Comparison" role="tabpanel" aria-labelledby="workspace-tab-Comparison" style={{display:tab === 'Comparison' ? undefined : 'none'}}>

        {/* PART 2 — comparison workspace */}
        <PartLabel n="Part 2" title="Comparison Workspace" />
        <ExperimentComparisonTable />
        </div>
        <div id="workspace-Evidence" role="tabpanel" aria-labelledby="workspace-tab-Evidence" style={{display:tab === 'Evidence' ? undefined : 'none'}}>
        <SelectedExperimentEvidence />
        <div className="mt-6 grid items-start gap-6 xl:grid-cols-2">
          <ResearchGaps output={output} />
          <SupportingSources output={output} />
        </div>
        </div>
      </main>
      <Constellation className="absolute bottom-6 right-6 w-40" />
    </div>
  );
}

function PartLabel({ n, title }: { n: string; title: string }) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <span className="display text-xs font-light uppercase tracking-[0.3em] text-teal">{n}</span>
      <span className="h-px w-8 bg-line" />
      <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-navy">{title}</span>
    </div>
  );
}
