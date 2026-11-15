import { AlertTriangle, Database, ExternalLink, FileText, Info } from 'lucide-react';
import type { ReportEvidence, SearchOutput } from '../types';
import { SectionTitle } from './Decor';
import { usePool } from './Shared';

export function ResearchGaps({ output }: { output: SearchOutput }) {
  const weak = /^\s*(weak|partial)/i.test(output.match_quality);
  return (
    <section id="gaps">
      <SectionTitle index="05" title="Research Gaps & Limitations" />
      <div className={`mb-8 flex items-start gap-3 border-l-2 pl-4 ${weak ? 'border-orange' : 'border-teal'}`}>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-teal">Match quality</p>
          <p className="mt-1 text-[15px] text-navy">{output.match_quality}</p>
          {weak && <p className="mt-1 text-sm text-muted">These results only partially address the search. Treat rankings and comparisons as indirect evidence.</p>}
        </div>
      </div>
      <div className="grid gap-10 md:grid-cols-2">
        <div>
          <h3 className="mb-3 text-lg font-medium uppercase tracking-wide">Gaps</h3>
          <ul className="space-y-3">
            {output.gaps.length ? output.gaps.map((g) => (
              <li key={g} className="flex items-start gap-3 text-sm leading-relaxed"><AlertTriangle size={15} strokeWidth={1.5} className="mt-0.5 shrink-0 text-orange" />{g}</li>
            )) : <li className="text-sm text-muted">No gaps reported.</li>}
          </ul>
        </div>
        <div>
          <h3 className="mb-3 text-lg font-medium uppercase tracking-wide">Caveats</h3>
          <ul className="space-y-3">
            {output.caveats.map((c) => (
              <li key={c} className="flex items-start gap-3 text-sm leading-relaxed"><Info size={15} strokeWidth={1.5} className="mt-0.5 shrink-0 text-teal" />{c}</li>
            ))}
          </ul>
        </div>
      </div>
      {output.overall_insights.length > 0 && (
        <div className="mt-10 border-t border-line pt-5">
          <h3 className="mb-2 text-lg font-medium uppercase tracking-wide">Overall Insights</h3>
          <ul className="space-y-1.5 text-sm">{output.overall_insights.map((s) => <li key={s}>— {s}</li>)}</ul>
        </div>
      )}
    </section>
  );
}

export function ReportEvidenceList({ evidence }: { evidence: ReportEvidence[] }) {
  return (
    <ul className="space-y-2 text-sm">
      {evidence.map((e) => (
        <li key={e.url} className="border-l border-line pl-3">
          <p className="font-medium">{e.title}</p>
          <p>{e.text}</p>
          <a className="text-teal hover:underline" href={e.url} target="_blank" rel="noreferrer">BASS-II Summary Report · PDF page {e.page}</a>
        </li>
      ))}
    </ul>
  );
}

export function SupportingSources({ output }: { output: SearchOutput }) {
  const pool = usePool();
  return (
    <section id="sources">
      <SectionTitle index="06" title="Supporting Papers & Sources" />
      <ol className="divide-y divide-line border-y border-line">
        {output.ranked.map((inv) => {
          const exps = [...pool.values()].filter((p) => p.inv.psi_id === inv.psi_id);
          const sources = new Map(exps.flatMap((p) => p.record?.sources ?? []).map((s) => [s.label, s]));
          const evidence = [...new Set(exps.flatMap((p) => p.exp.evidence))];
          return (
            <li key={inv.psi_id} className="grid gap-4 py-6 md:grid-cols-[220px_1fr]">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-teal">{inv.psi_id}</p>
                <p className="display mt-1 text-lg font-medium uppercase leading-tight">{inv.name}</p>
              </div>
              <div className="space-y-3 text-sm">
                <a href={inv.reference_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-teal hover:underline">
                  <Database size={13} strokeWidth={1.5} /> Investigation record — {inv.reference_link} <ExternalLink size={11} />
                </a>
                {[...sources.values()].map((s) => (
                  <div key={s.label} className="flex items-start gap-2">
                    <FileText size={13} strokeWidth={1.5} className="mt-0.5 shrink-0 text-orange" />
                    <div>
                      {s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="text-navy hover:text-orange">{s.label}</a> : <span className="text-navy">{s.label}</span>}
                      <p className="text-xs text-muted">
                        {[s.authors, s.year, s.pages, s.kind].filter(Boolean).join(' · ')}
                        <span className={`ml-2 uppercase tracking-[0.14em] ${s.verified ? 'text-teal' : ''}`}>{s.verified ? 'verified' : 'not verified'}</span>
                      </p>
                    </div>
                  </div>
                ))}
                {!!inv.report_evidence?.length && (
                  <>
                    <h4 className="font-medium">Findings from the report</h4>
                    <ReportEvidenceList evidence={inv.report_evidence} />
                  </>
                )}
                {evidence.length > 0 && <p className="text-xs text-muted"><span className="font-medium text-navy">Relevant record fields / pages:</span> {evidence.join(' · ')}</p>}
              </div>
            </li>
          );
        })}
      </ol>
      {output.inputs_used.length > 0 && (
        <p className="mt-4 text-xs text-muted"><span className="font-medium text-navy">Inputs used:</span> {output.inputs_used.join(', ')}</p>
      )}
    </section>
  );
}
