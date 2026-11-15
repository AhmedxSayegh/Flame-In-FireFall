# Team frontend integration

The visual source in this folder comes from `flame-in-freefall.zip`. This build is API-only. The original team README and source are preserved at `../integrations/team-frontend-source` for reference; its demo mode and example port 8000 do not describe the integrated application.

## Actual connection

- Production: http://127.0.0.1:5000, Flask serves `frontend/dist` and `/api` on the same origin.
- Development: `npm run dev` in this folder, http://localhost:5173, with `/api` proxied by Vite to http://127.0.0.1:5000.
- Public optional setting: `VITE_API_BASE_URL=/api`. No LLM credentials belong in frontend variables.
- `POST /api/search` receives `{input,research_question}` and returns `{output,meta,records}`. `lib/api.ts` validates/unpacks this envelope and uses inline records when present.
- Existing `GET /api/records?experiment_ids=A,B` is used when inline records are absent. Missing/failed record requests are reported explicitly, with no synthetic substitute.
- Canonical input/output contracts remain in `../shared/schemas`. The team's bundled copies match, but active validation imports the canonical files.
- The team's local engine/fixture source is retained for traceability. It never supplies API-mode results. The only engine exports used by UI components are display labels and comparison helpers; backend ranking and scores are rendered unchanged.
- A saved-example response from an unconfigured backend is rejected as an integration state; it is not presented as a new live search.

Research question: sent outside the strict input object, saved in backend run input, **not included in Gemini prompts**. Integration does not alter that behavior.

## Commands

From repository root, backend:

```
.venv\Scripts\python.exe backend\app.py
```

From `frontend`:

```
npm.cmd run dev
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

`start.bat` launches the built application. `dev.bat` starts both development processes. Runtime provider/model/settings, prompts and source datasets remain in the existing backend.

## Rollback

```
.venv\Scripts\python.exe tools\restore_previous_frontend.py --check
.venv\Scripts\python.exe tools\restore_previous_frontend.py
```

Run the second command only when you intend to roll back. It restores the pre-integration frontend and snapshots the integrated files before replacement. It does not restore or modify backend/environment files.
