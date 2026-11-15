# Team frontend integration

The visual source in this folder comes from `flame-in-freefall.zip`. This build is API-only. The supplied team frontend is integrated into the existing application; its proposed demo mode and example port 8000 do not describe the actual backend.

## Actual connection

- Production: http://127.0.0.1:5000, Flask serves `frontend/dist` and `/api` on the same origin.
- Development: `npm run dev` in this folder, http://localhost:5173, with `/api` proxied by Vite to http://127.0.0.1:5000.
- Public optional setting: `VITE_API_BASE_URL=/api`. No LLM credentials belong in frontend variables.
- `POST /api/search` receives `{input,research_question}` and returns `{output,meta,records}`. `lib/api.ts` validates/unpacks this envelope and uses inline records when present.
- Existing `GET /api/records?experiment_ids=A,B` is used when inline records are absent. Missing/failed record requests are reported explicitly, with no synthetic substitute.
- Canonical input/output contracts remain in `../shared/schemas`. Active validation imports these canonical files.
- The team's local engine/fixture source is retained for traceability. It never supplies API-mode results. The only engine exports used by UI components are display labels and comparison helpers; backend ranking and scores are rendered unchanged.
- A saved-example response from an unconfigured backend is rejected as an integration state; it is not presented as a new live search.

The research-question UI and summary chip are removed. Previously persisted question values are cleared; this UI sends `research_question: null`. The API contract and backend support remain unchanged.

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

## Recovered frontend

This publication uses the pre-animation file checkpoint plus unchanged frontend files over commit `59076c1d53b2be0d3826bfde743011c5b8599e02`. It retains the three-tab layout and globally scoped local selections. See [publication verification](../docs/PRE_ANIMATION_PUBLICATION.md). The completed Animation working project was preserved separately; this checkout does not modify it.
