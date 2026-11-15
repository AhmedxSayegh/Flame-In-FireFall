import type { SourceRef } from '../types';
export function sourceIdentity(source:SourceRef, investigation:string, inputs:string[]):string {
  if(source.url){try{const u=new URL(source.url);u.hash='';return u.hostname.toLowerCase()==='doi.org'?`doi:${u.pathname.toLowerCase()}`:u.toString().replace(/\/$/,'');}catch{return source.url;}}
  const paths=inputs.filter(p=>p.split('/').pop()===source.label&&p.startsWith(`${investigation}/`));
  // Exact document path, scoped to investigation. Similar labels are never matched fuzzily.
  return paths.length===1?paths[0]:`${investigation}:unidentified:${JSON.stringify(source)}`;
}
