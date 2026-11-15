import type { ExperimentRecord, SearchOutput, SearchRequest } from '../types';
import { adaptBackendRecord } from './recordAdapter';
import { cleanInput, validateInput, validateOutput } from './schema';

// This integrated build is API-only, even if an old demo environment variable remains.
export const DATA_SOURCE = 'api' as 'demo' | 'api';
const BASE = (import.meta.env.VITE_API_BASE_URL?.trim() || '/api').replace(/\/$/, '');

export class SchemaError extends Error {
  constructor(public stage: 'input' | 'output', public errors: string[]) {
    super(`${stage} schema validation failed`);
  }
}
export class ApiError extends Error {
  constructor(message: string, public details: string[] = [], public httpStatus?: number) { super(message); }
}
export interface RunMeta {
  mode?: string; model?: string | null; run_id?: string; duration_s?: number;
  valid?: boolean; validation_errors?: string[]; integrity_notes?: string[];
}
export interface SearchResult {
  output: SearchOutput; records: Record<string, ExperimentRecord>; meta?: RunMeta; warnings: string[];
}

async function jsonResponse(res: Response, stage: string): Promise<Record<string, unknown>> {
  let body: Record<string, unknown>;
  try { body = await res.json(); }
  catch { throw new ApiError(`${stage} returned HTTP ${res.status} without a JSON response. Check the API URL and backend.`); }
  if (!res.ok) throw new ApiError(typeof body.error === 'string' ? body.error : `${stage} failed: HTTP ${res.status}`,
    Array.isArray(body.details) ? body.details.filter((x): x is string => typeof x === 'string') : [], res.status);
  return body;
}

/** Adapt the existing Flask envelope; never invoke a local ranking or demo substitute. */
export async function search(req: SearchRequest): Promise<SearchResult> {
  const input = cleanInput(req.input);
  const vi = validateInput(input);
  if (!vi.ok) throw new SchemaError('input', vi.errors);
  let response: Response;
  try {
    response = await fetch(`${BASE}/search`, { method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({input,research_question:req.research_question}) });
  } catch { throw new ApiError(`Cannot reach the research backend at ${BASE}. Start the backend and check the API connection.`); }
  const body = await jsonResponse(response, 'Search');
  const meta = body.meta as RunMeta | undefined;
  if (meta?.mode === 'saved_example') throw new ApiError('The backend is in saved-example mode. Configure its Gemini connection to perform a live search. No synthetic data was substituted.');
  if (meta?.valid === false) throw new ApiError('The backend reported an invalid output.',meta.validation_errors ?? []);
  const output = body.output ?? body;
  const vo = validateOutput(output);
  if (!vo.ok) throw new SchemaError('output', vo.errors);
  const out = output as SearchOutput;
  const warnings: string[] = [];
  const records: Record<string,ExperimentRecord> = {};
  const expected = new Map(out.ranked.flatMap(inv => inv.top_experiments.map(e => [e.experiment_id,inv.psi_id] as const)));
  const accept = (raw: unknown) => {
    if (!Array.isArray(raw)) throw new ApiError('The records response must contain a records array.');
    for (const value of raw) {
      const record=adaptBackendRecord(value);
      if (record && expected.get(record.experiment_id) === record.psi_id) records[record.experiment_id]=record;
      else warnings.push('A malformed or unexpected numeric record was omitted; no replacement values were generated.');
    }
  };
  try {
    if (Array.isArray(body.records)) accept(body.records);
    else if (expected.size) {
      const res=await fetch(`${BASE}/records?experiment_ids=${encodeURIComponent([...expected.keys()].join(','))}`);
      const data=await jsonResponse(res,'Numeric records');
      accept(data.records ?? data);
    }
  } catch (e) { warnings.push(`Numeric-record integration failed: ${e instanceof ApiError && e.httpStatus ? `HTTP ${e.httpStatus}: ` : ''}${e instanceof Error ? e.message : 'Unknown error'}. The ranked result is retained; affected charts are unavailable.`); }
  const missing=[...expected.keys()].filter(id => !records[id]);
  if (missing.length) warnings.push(`Numeric records were not supplied for ${missing.join(', ')}. This is a record-loading issue, distinct from an unavailable measurement within a loaded test.`);
  return {output:out,meta,records,warnings};
}
