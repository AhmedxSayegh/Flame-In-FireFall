import { sourceIdentity } from '../lib/sourceCatalog';
import type { SourceRef } from '../types';
import { AlertTriangle, Info } from 'lucide-react';
import type { SearchOutput } from '../types';
import { Panel, PanelTitle } from './Decor';
import { usePool } from './Shared';
import { useSearch } from '../state/SearchContext';

export function ResearchGaps({ output, className = '' }: { output: SearchOutput; className?: string }) {
  const weak = /^\s*(weak|partial)/i.test(output.match_quality);
  return (
    <Panel id="gaps" className={`@container flex flex-col ${className}`}>
      <PanelTitle index="05" title="Research Gaps & Limitations" kicker="Search-wide: match quality, gaps, caveats and overall insights cover the complete search results, not only this investigation." />
      <div className="pr-1">
      <div className={`mb-6 flex items-start gap-3 border-l-2 pl-4 ${weak ? 'border-orange' : 'border-teal'}`}>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-teal">Match quality</p>
          <p className="mt-1 text-[15px] text-navy">{output.match_quality}</p>
          {weak && <p className="mt-1 text-sm text-muted">These results only partially address the search. Treat rankings and comparisons as indirect evidence.</p>}
        </div>
      </div>
      <div className="grid gap-6 @3xl:grid-cols-2">
        <div>
          <h3 className="mb-3 text-lg font-medium uppercase tracking-wide">Research Gaps</h3>
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
        <div className="mt-6 border-t border-line pt-5">
          <h3 className="mb-2 text-lg font-medium uppercase tracking-wide">Overall Insights</h3>
          <ul className="space-y-1.5 text-sm">{output.overall_insights.map((s) => <li key={s}>— {s}</li>)}</ul>
        </div>
      )}
      </div>
    </Panel>
  );
}

export function SupportingSources({ output, className = '' }: { output: SearchOutput; className?: string }) {
  const pool=usePool();
  const {investigationId}=useSearch();
  const catalog=new Map<string,{refs:SourceRef[];experiments:Set<string>;investigations:Set<string>}>();
  for(const inv of output.ranked.filter(inv=>inv.psi_id===investigationId)){
    const experiments=[...pool.values()].filter(p=>p.inv.psi_id===inv.psi_id);
    if (!experiments.length) {
      const ref:SourceRef={label:inv.name+' investigation record',url:inv.reference_link,kind:'dataset',verified:false};
      catalog.set(sourceIdentity(ref,inv.psi_id,output.inputs_used),{refs:[Object.assign(ref,{recordOnly:true})],experiments:new Set(),investigations:new Set([inv.psi_id])});
    }
    for(const exp of experiments){
      const refs:(SourceRef & {recordOnly?:boolean})[]=[{label:inv.name+' investigation record',url:inv.reference_link,kind:'dataset',verified:false,recordOnly:true},...(exp.record?.sources??[])];
      for(const ref of refs){const id=sourceIdentity(ref,inv.psi_id,output.inputs_used);const entry=catalog.get(id)??{refs:[],experiments:new Set<string>(),investigations:new Set<string>()};
        if(!entry.refs.some(r=>JSON.stringify(r)===JSON.stringify(ref)))entry.refs.push(ref);
        entry.experiments.add(exp.id);entry.investigations.add(inv.psi_id);catalog.set(id,entry);
      }
    }
  }
  return <Panel id="sources" className={className}><PanelTitle index="06" title="Supporting Papers & Sources" />
    <ol className="divide-y divide-line">{[...catalog].map(([id,entry])=><li key={id} data-source-id={id} className="py-4">
      <p className="mb-2 text-xs text-teal">{[...entry.investigations].join(' · ')}</p>
      <p className="font-medium text-sm">{entry.refs[0].url?<a href={entry.refs[0].url} className="text-teal hover:underline" target="_blank" rel="noreferrer">{entry.refs[0].label}</a>:entry.refs[0].label}</p>
      <div className="mt-2 space-y-1 text-xs text-muted">{entry.refs.map((r,i)=><p key={i}>{[r.label,r.authors,r.year,r.pages,r.kind].filter(Boolean).join(' · ')} · {(r as SourceRef & {recordOnly?:boolean}).recordOnly?'verification status not supplied':r.verified?'verified':'not verified'}{r.url&&r.url!==entry.refs[0].url&&<> · <a href={r.url}>{r.url}</a></>}</p>)}</div>
      <details className="mt-3"><summary className="cursor-pointer text-sm">Experiment references and supporting claims ({entry.experiments.size})</summary><p className="mt-2 text-xs text-muted">The record associates these sources with each experiment. Individual source-to-claim attribution is shown only through the supplied evidence text below.</p>
        {[...entry.experiments].map(expId=>{const exp=pool.get(expId)!;return <div className="mt-3 border-l border-line pl-3 text-xs" key={expId}><p className="font-medium">{expId} · {exp.exp.tests.map(t=>t.test_identifier).join(', ')}</p><p className="mt-1">{exp.exp.summary_of_key_findings}</p><ul className="mt-1 space-y-1">{exp.exp.evidence.map(e=><li key={e}>{e}</li>)}</ul></div>;})}
      </details>
    </li>)}</ol>{catalog.size===0 && <p className="text-sm text-muted">No sources available for the selected investigation.</p>}<p className="mt-4 text-xs text-muted">Search-wide inputs used: {output.inputs_used.join(', ')}</p>
  </Panel>;
}
