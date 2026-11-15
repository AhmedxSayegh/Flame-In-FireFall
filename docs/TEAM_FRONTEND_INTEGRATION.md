# Supplied team frontend integration — 15 November 2026

The complete supplied React frontend is integrated and served at **http://127.0.0.1:5000** by the existing Flask backend. Its typography, colours, responsive layout, ranking/analysis panels and comparison workspace are preserved. This phase adds the API connection and necessary loading/error diagnostics; it does not implement the earlier proposed viewer or redesign.

## Source, preservation and reversibility

- Inspected `C:\Users\Moath\Downloads\flame-in-freefall.zip`: 31 files, including `src/main.tsx`, components, state, types, schemas and chart helpers. All referenced source imports exist. The archive has **no `public/` directory**; existing project report PDFs remain available in `frontend/public/reports`.
- The pristine team source and README are preserved at [integrations/team-frontend-source](../integrations/team-frontend-source).
- Before replacing anything, preserved the previous frontend in [frontend-before.zip](../backups/2026-11-15-team-integration/frontend-before.zip), with the previous live source/tests also retained separately. Root documentation and launchers were backed up. There is no Git metadata in this workspace; these files are the rollback basis.
- Team dependency versions match the existing application's versions. Dependencies were not blindly replaced. `package-lock.json`, Vite configuration and TypeScript configuration remain byte-identical to their pre-integration copies.
- Only six team source files needed integration edits: `lib/api.ts`, `lib/recordAdapter.ts`, `lib/schema.ts`, `components/Filters.tsx`, `state/SearchContext.tsx`, and `pages/ResultsPage.tsx`. All 18 other source files, including CSS, visual components, charts and their data transformations, match the supplied source byte for byte.
- All **13 protected files** remain unchanged: backend configuration, Python implementation/tests, system prompt, investigation records/PDFs and shared schemas. The integrity check compares hashes without displaying credentials. The backend key was not found in frontend source or built assets.

Rollback verification:

```powershell
.\.venv\Scripts\python.exe tools\restore_previous_frontend.py --check
```

To intentionally restore the previous frontend, run the same command without `--check`. That script first snapshots the integrated frontend. Backend/environment files are never restored or overwritten. The check passed for the 45-file backup; rollback itself was not performed.

## Real API versus the team's proposed contract

| Concern | Supplied frontend/README proposal | Existing backend and integrated behavior |
|---|---|---|
| API address | Example `http://localhost:8000/api` | Flask is on `127.0.0.1:5000`; production uses same-origin `/api` |
| Data mode | Demo fixture or API, demo default | API only; no local ranking/demo fallback |
| Search | `POST {BASE}/search`, bare schema output | Existing `POST /api/search`, `{input,research_question}` → `{output,meta,records}`; adapter unwraps and validates |
| Numeric records | Separate `GET {BASE}/records?experiment_ids=…` | Existing `/api/records` returns `{records:[...]}`. Inline search records are reused first, avoiding a redundant request |
| Schemas | Team copies in `src/schemas` | Team copies are JSON-equal to the approved shared schemas; active validation imports `shared/schemas` |
| Development | Example backend port | Retained Vite `/api` proxy to actual port 5000, including access to canonical shared schema imports |

No backend route or CORS change was needed. The adapter supports the real envelope and the team's proposed bare response, but it does not invent endpoints or replace failed responses with fixtures.

Search HTTP errors and validation details remain visible. A backend `saved_example` response is explicitly rejected as a live-search integration state. Failed record transport is reported separately from an absent scientific measurement inside a loaded record. The ranked response remains available when numeric-record loading fails. Duplicate form submissions are guarded while a request is in flight; no frontend retries or additional generation calls were introduced.

Numeric records are accepted only for experiment IDs in the returned ranking and their matching investigation ID. Finite recorded numeric values, including zero, are retained. Invalid numeric strings are not coerced into values. The team's chart layer groups measurements by quantity, unit and definition, and never derives burning rates from narrative outcomes. Missing values are not replaced with zero. Existing outcome-count charts use counts of recorded categories, not invented measurements.

## Active backend and data

- Flask: [backend/app.py](../backend/app.py), existing `/api` routes and ranking pipeline.
- Runtime `/api/status`: `mode=live`, `model=gemini-4-hydrogen`, `configured_model=gemini-4-hydrogen`, `report_mode=text`. These settings were preserved, not changed by integration.
- BASS-II: [PSI-25/record.json](../backend/data/psi/PSI-25/record.json), 74 condition sets, and `BASS-II_Summary_Report.pdf`.
- FLEX: [PSI-69/record.json](../backend/data/psi/PSI-69/record.json), 86 condition sets, and `FLEX_EIRD_v4.pdf`.
- Backend ranking, scores, selected experiments, narratives, evidence strings and source URLs are displayed from the response. The team's retained `runEngine` and synthetic fixture do not supply results. UI imports from `engine.ts` use only display labels/comparison helpers.

## Live end-to-end result

Exactly **one live verification search** was submitted for this integration. It succeeded through the actual browser, frontend and Flask/Gemini connection. Further interaction/failure checks used the saved response, without additional generation requests.

| Recorded item | Result |
|---|---|
| Run ID | `20261115-014041-825` |
| Model reported by backend | `gemini-4-hydrogen` |
| Backend output validation | `valid=true` |
| Generation requests recorded by backend | **1** |
| Backend pipeline duration | **22.748 s** |
| Data preparation | 117.708 ms |
| Gemini API phase | 22,620.732 ms |
| Response processing | 9.647 ms |
| Chart record assembly | 1.056 ms |
| Loaded experiment records | 6, containing 21 test rows |

The input was Lunar Base / Fire Prevention / Material Flammability / All Investigations / Solid Materials / Flame Spread Rate, with oxygen 30%, pressure 70.3 kPa, airflow 1 cm/s and microgravity. Browser verification confirmed the exact serialized values reached the search request. The saved request and response are available in [live-response.json](team-integration/live-response.json) and [browser-verification.json](team-integration/browser-verification.json).

Loaded record IDs: `PSI-25-CS02`, `PSI-25-CS07`, `PSI-25-CS61`, `PSI-69-CS14`, `PSI-69-CS55`, `PSI-69-CS56`.

The browser verification's `duration_browser_s` on reruns measures **saved-response replay**, not live model latency. Only the table above is the actual saved backend timing. This integration does not establish a model speed improvement or a new benchmark.

## Research-question behavior

The field exists, is submitted, and is saved; **Gemini still does not use it**. No change was made to this behavior.

- [SearchContext.tsx](../frontend/src/state/SearchContext.tsx) serializes the trimmed value separately from the strict `input` object.
- [api.ts](../frontend/src/lib/api.ts) sends `{input,research_question}`.
- [app.py:122](../backend/app.py#L122) reads it, and line 136 includes it in saved `run_input`.
- Prompt construction at [app.py:162](../backend/app.py#L162) builds text/report parts from investigations, filter query and prescores; the subsequent `gc.generate(...)` receives those parts, not `research_question`.
- The offline [trace result](research-question-current.json) verifies two different questions are saved but create identical captured Gemini payloads. This trace made zero actual API calls. The earlier original-baseline trace is retained separately in `research-question-original.json`.

## Checks and screenshots

| Check | Result |
|---|---|
| `npm.cmd run typecheck` | Passed |
| `npm.cmd test` | 8 integration tests passed, 0 failed |
| `npm.cmd run build` | Passed; Vite large-chunk warning remains |
| Existing backend unit tests | 8 passed; mocked/offline, no generation calls |
| Original frontend rollback archive | Check passed; 45 files |
| Protected file/schema/dependency checks | Passed; [integrity-verification.json](team-integration/integrity-verification.json) |
| Edge desktop 1440px; results at 390/768/1024px | Rendered; no horizontal page overflow; no browser runtime errors |
| Investigation/experiment selection | Every returned investigation and experiment tab checked; correct active state, IDs and source URL |
| Comparison/charts | Selection across investigations; every comparison-chart tab; numeric table checked against actual loaded value/unit; missing flame-spread chart explained |
| Sources | Selected-source and supporting-source hrefs match the returned investigation URLs; report/evidence labels retained. External DOI sites were not audited for availability |
| Loading/error/empty states | Disabled loading button; injected HTTP 409, schema failure, empty ranking and records HTTP 503 all verified; no synthetic substitution |
| Vite dev proxy | Page, `/api/status`, numeric-record route and canonical schema import all returned HTTP 200; [dev-proxy-verification.json](team-integration/dev-proxy-verification.json) |

The browser harness automatically replays the saved live response when it exists. Error/empty-state scenarios are explicitly injected checks, not claims about actual provider failures. Source and chart interactions reused loaded results.

- [Search screen](team-integration/search-desktop.png)
- [Desktop results](team-integration/results-desktop.png) · [desktop viewport](team-integration/results-desktop-viewport.png)
- [Mobile results](team-integration/results-mobile.png) · [mobile viewport](team-integration/results-mobile-viewport.png)
- [Real experiment analysis](team-integration/analysis-real-record.png)
- [Comparison chart](team-integration/charts-real-records.png) · [numeric chart table](team-integration/chart-numeric-data.png)

## Remaining limitations

1. The selected BASS-II records contain conditions/outcomes but no numeric flame-spread measurements. The airflow-versus-spread plot therefore reports missing measurements. This is a data limitation, not failed API integration.
2. Existing FLEX numeric records label burning rate `mm²/s` while their definition explicitly notes the source table's ambiguous `mm` heading and the assumed burning-rate constant. That upstream unit assumption is preserved and visible in chart definitions; it was not newly verified or silently resolved by this integration.
3. The research question remains unused by Gemini, as described above. Ranked results remain the existing backend's behavior, including partial matches from a different fuel category; frontend integration does not rerank them.
4. Team missing-value text remains `N/A` in this design-preserving phase. Narrative scientific accuracy, evidence presentation and the combustion viewer require their separately requested review/design phase.
5. The production entry is about 810 kB before gzip (about 236 kB gzip), triggering Vite's 500 kB chunk warning. Dependencies/charts were preserved for this integration; bundle splitting was not performed.
6. Custom browser paint measurements from the previous frontend were not carried into the supplied team's implementation. Existing backend phase timings remain available. No performance comparison between the two interfaces is claimed here.

## Run locally

The built application is currently running at **http://127.0.0.1:5000**. Its backend remains running for local use. The temporary Vite verification server and test browsers were stopped.

Built frontend + backend, from repository root:

```powershell
.\.venv\Scripts\python.exe backend\app.py
```

To rebuild the frontend first:

```powershell
cd frontend
npm.cmd run build
cd ..
.\.venv\Scripts\python.exe backend\app.py
```

For live frontend development, keep that backend running and use a second terminal:

```powershell
cd frontend
npm.cmd run dev
```

Then open http://localhost:5173. Existing `start.bat`, `dev.bat` and `build-frontend.bat` remain available. Do not start a second backend on port 5000 while the current one is running. Gemini credentials stay exclusively in `backend/.env`; no frontend credentials are needed.
