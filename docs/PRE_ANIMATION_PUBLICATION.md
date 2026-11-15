# Pre-animation frontend publication

This branch publishes the completed frontend selection/layout work immediately before the Animation feature. It is a **reconstruction from file checkpoints**, not an exact recovered Git revision.

## Baseline and recovery

- Git parent: `59076c1d53b2be0d3826bfde743011c5b8599e02` (`origin/frontend-improvements`). This contains the integrated team frontend, restored graphs, comparison layout, and evidence consolidation.
- File checkpoint: `backups/animation-before/` from the original working project. Restored its ResultsPage, InvestigationRanking, SelectedExperimentAnalysis, Shared, ComparisonCharts, CSS, and ten-test suite.
- Other frontend source files were copied from the original project because they were unchanged by Animation. All 25 runtime source files were byte-verified against their selected source/checkpoint before Git line-ending normalization.
- No single Git commit contained the complete pre-animation selection work. The recovered source adds the investigation strip, common investigation scope, scoped selectors, and research-question removal to the Git parent.
- The completed Animation project remains in its original working directory. Before reconstruction, a private external archive preserved 655 files, including uncommitted source/config/data and built output. Archive CRC and SHA256 checks passed. Generated dependency environments and Git metadata were omitted. The archive and manifests are not committed.
- A final integrity comparison found no original source/config/data/build changes or missing files. Only the active backend's HTTP log grew naturally during read-only connection checks; its earlier content is also in the recovery archive.

## Included frontend behavior

- Experiment / Comparison / Evidence tabs retain their pre-animation location and layout.
- Investigation strips appear only in Comparison and Evidence, populated from all loaded investigations.
- A single authoritative investigation selection scopes all experiment selectors, comparisons, chart series, and selected evidence. Local tab changes preserve state and do not invoke the search API.
- Investigation changes discard foreign comparison IDs, prevent duplicates, select a valid ranked default, and handle empty/single-experiment cases without borrowing another investigation's experiments.
- The research-question control and chip remain removed. Legacy stored text is cleared and the UI submits `research_question: null`; backend/API support remains unchanged.
- The restored individual/comparison graph implementation, three comparison slots, Data/CSV controls, expanded similarities/differences, conclusion placement, and consolidated evidence remain accessible.

## Excluded material and unchanged contracts

No Animation tab, viewer, scene components, helper, styles, assets, tests, skill installation, or navigation relocation is present. Dependencies were not changed. No private environment files, packages, recovery folders, runtime build output, or temporary files are newly published. The previously tracked generated `frontend/tsconfig.tsbuildinfo` was removed from Git and ignored; it still regenerates normally.

Backend source, model defaults, prompts, schemas, API contracts, and research datasets are unchanged from the Git parent. The original working backend has separate local changes; they were intentionally not transferred. The unrelated remote `fix/ranking-evidence-charts` branch was not merged or rewritten. Existing history and remote branches remain intact.

## Verification

- `npm.cmd ci --offline --no-audit --no-fund`: passed using the existing lockfile, no upgrades.
- `npm.cmd run typecheck`: passed.
- `npm.cmd test`: all 10 pre-animation tests passed; no animation-specific test included.
- `npm.cmd run build`: passed. CSS `index-QguVD6CS.css`, JS `index-Cgnt3cfh.js`, approximately 816.64 kB / 238.44 kB gzip. The existing large-bundle warning remains.
- Headless Edge tested the isolated production build at `http://127.0.0.1:5175`. The original Animation app stayed on port 5000. Tests assert exactly three tabs, their original location, no Animation workspace, scoped BASS-II/FLEX options in every dropdown, synchronized investigation changes, cleared source inspection, unique comparison slots, optional-third clearing, table/series updates, retained chart selection, source catalog scope, missing-data messaging, Data/CSV, expanded summaries and conclusion placement.
- Tested BASS-II `PSI-25-CS07`, `PSI-25-CS02`, `PSI-25-CS68`; FLEX `PSI-69-CS55`, `PSI-69-CS56`, `PSI-69-CS14`. Desktop 1440px and mobile 390/320px had no horizontal page overflow.
- Four explicit replayed submits cover normal, single-experiment, empty-investigation, and empty-result cases. Saved real outputs/records are test-only network responses; application runtime remains API-only. **Zero generation requests and zero extra search/record requests during local navigation.** No console/page errors, failed requests, or HTTP errors.
- Actual read-only `/api/status` and `/api/records` requests through the isolated frontend proxy returned HTTP 200 from the existing backend; BASS-II CS07 returned 3 tests and FLEX CS55 returned 4. No live generation POST was made.
- `git diff --check` passed. Backend/schema/dependency diffs are empty. The staged file list and content were reviewed for private keys, environment files, generated packages, and recovery/temporary material before commit.

## Reproduce browser verification

Serve the existing backend on port 5000. From `frontend`, build then run `npm.cmd run preview -- --host 127.0.0.1 --port 5175 --strictPort`. Install Playwright in your Python environment and run:

```powershell
$env:VERIFY_URL='http://127.0.0.1:5175'
python tools/verify_investigation_scope.py
```

The browser harness intercepts search requests with the already tracked real saved response; it never invokes a provider. The production UI itself has no replay or demo fallback.

## Screenshots and check output

- [Comparison desktop](investigation-scope/comparison-flex-desktop.png)
- [Evidence desktop](investigation-scope/evidence-flex-desktop.png)
- [Comparison mobile](investigation-scope/comparison-mobile.png)
- [Evidence mobile](investigation-scope/evidence-mobile.png)
- [Search page](investigation-scope/search-desktop.png)
- [Browser check output](investigation-scope/verification.json)
