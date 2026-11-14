/**
 * The ONLY file that talks to the backend (backend/app.py).
 *
 *   GET  /api/status                         → getStatus()
 *   POST /api/search   {input, research_question} → search()   returns {output, meta}
 *   GET  /api/records?experiment_ids=A,B,C   → used inside search() for the charts
 *
 * In production the backend serves this app, so "/api" is the same address.
 * In development (npm run dev) vite.config.ts forwards "/api" to http://127.0.0.1:5000.
 */
import type { BackendStatus, ExperimentRecord, RunMeta, SearchOutput, SearchRequest, SearchResponse } from '../types';
import { adaptBackendRecord } from './recordAdapter';
import { cleanInput, validateInput, validateOutput } from './schema';

const API = '/api';

export class SchemaError extends Error {
  constructor(public stage: 'input' | 'output', public errors: string[]) {
    super(`${stage} schema validation failed`);
  }
}

export interface SearchResult { output: SearchOutput; meta: RunMeta; records: Record<string, ExperimentRecord> }

/** Backend mode (live Gemini or saved example), model name and loaded investigations. */
export async function getStatus(): Promise<BackendStatus> {
  const res = await fetch(`${API}/status`);
  if (!res.ok) throw new Error(`Backend status failed: HTTP ${res.status}`);
  return res.json();
}

/** User inputs → validate input → backend search → validate output → per-test records for the charts. */
export async function search(req: SearchRequest): Promise<SearchResult> {
  const input = cleanInput(req.input);
  const vi = validateInput(input);
  if (!vi.ok) throw new SchemaError('input', vi.errors);

  const res = await fetch(`${API}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input, research_question: req.research_question }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error ?? `Search failed: HTTP ${res.status}`) as Error & { details?: string[] };
    err.details = Array.isArray(body.details) ? body.details : [];
    throw err;
  }
  const { output, meta } = body as SearchResponse;

  const vo = validateOutput(output);
  if (!vo.ok) throw new SchemaError('output', vo.errors);

  // Numeric per-test records for the charts. If this fails, tables and text still render.
  const records: Record<string, ExperimentRecord> = {};
  const ids = output.ranked.flatMap((r) => r.top_experiments.map((e) => e.experiment_id));
  if (ids.length) {
    try {
      const r = await fetch(`${API}/records?experiment_ids=${encodeURIComponent(ids.join(','))}`);
      if (r.ok) {
        for (const raw of ((await r.json()).records ?? []) as unknown[]) {
          const rec = adaptBackendRecord(raw);
          if (rec) records[rec.experiment_id] = rec;
        }
      }
    } catch { /* charts show empty states that name the missing records */ }
  }
  return { output, meta, records };
}
