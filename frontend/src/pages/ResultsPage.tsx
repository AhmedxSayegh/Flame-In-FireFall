import { ArrowLeft } from 'lucide-react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ComparisonCharts } from '../components/ComparisonCharts';
import { Constellation, Divider, Orbit, Star } from '../components/Decor';
import { ExperimentComparisonTable } from '../components/ExperimentComparisonTable';
import { ResearchGaps, SupportingSources } from '../components/GapsAndSources';
import { InvestigationRanking } from '../components/InvestigationRanking';
import { SelectedExperimentAnalysis } from '../components/SelectedExperimentAnalysis';
import { DataSourceBadge, RunInfo, SavedExampleBanner } from '../components/Shared';
import { DEFAULT_FORM, useSearch, type FormState } from '../state/SearchContext';

const CHIP_LABEL: Partial<Record<keyof FormState, string>> = {
  crew_environment: 'Environment', fire_safety_category: 'Category', research_topic: 'Topic', investigation: 'Investigation',
  fuel_type: 'Fuel', measurement_type: 'Measurement', oxygen_pct: 'O₂ %', pressure_kpa: 'kPa', airflow_cm_s: 'cm/s', gravity_level: 'Gravity',
};

export default function ResultsPage() {
  const { result, submittedForm } = useSearch();
  const nav = useNavigate();
  if (!result || !submittedForm) return <Navigate to="/" replace />;
  const { output, meta } = result;
  const chips = (Object.keys(CHIP_LABEL) as (keyof FormState)[]).filter((k) => submittedForm[k] !== DEFAULT_FORM[k]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-white">
      <Orbit className="absolute -right-20 top-4 hidden w-[520px] md:block" w={520} h={180} tilt={-14} />
      <header className="relative mx-auto max-w-6xl px-5 pt-8 sm:px-8">
        <div className="flex items-center justify-between gap-4">
          <button type="button" onClick={() => nav('/')} className="btn-ghost"><ArrowLeft size={13} /> Back to Filters</button>
          <DataSourceBadge />
        </div>
        <div className="relative mt-14">
          <Star size={12} className="absolute -top-6 left-0" color="#EA8B33" />
          <Star size={8} className="absolute -top-3 left-[38%]" />
          <h1 className="text-[52px] font-medium uppercase leading-none sm:text-[80px]">Research Results</h1>
          <p className="mt-3 text-lg font-light text-teal">NASA PSI Combustion Experiment Analysis</p>
        </div>
        <div className="mt-8 flex flex-wrap gap-2 border-y border-line py-3 text-xs">
          {chips.length === 0 ? <span className="text-muted">No filters applied — all loaded investigations shown.</span> : chips.map((k) => (
            <span key={k} className="pill"><span className="text-muted">{CHIP_LABEL[k]}</span> {submittedForm[k]}</span>
          ))}
          {submittedForm.research_question.trim() && <span className="pill max-w-full truncate"><span className="text-muted">Question</span> {submittedForm.research_question}</span>}
        </div>
        <div className="mt-4 space-y-3"><SavedExampleBanner meta={meta} /><RunInfo meta={meta} /></div>
      </header>

      <main className="relative mx-auto max-w-6xl px-5 pb-24 pt-14 sm:px-8">
        <InvestigationRanking ranked={output.ranked} />
        <Divider />
        <ExperimentComparisonTable />
        <Divider />
        <ComparisonCharts />
        <Divider />
        <SelectedExperimentAnalysis />
        <Divider />
        <ResearchGaps output={output} />
        <Divider />
        <SupportingSources output={output} />
      </main>
      <Constellation className="absolute bottom-6 right-6 w-40" />
    </div>
  );
}
