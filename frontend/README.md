# Flame in Freefall: frontend

React 18, TypeScript, Vite 6, Tailwind 4, Recharts, Ajv. See the project README (one folder up) for how this connects to the backend.

```bash
npm install
npm run dev      # http://localhost:5173, /api forwarded to the backend on :5000
npm run build    # writes dist/, which the backend serves at http://127.0.0.1:5000
```

## Files

| File | Role |
|---|---|
| `src/lib/api.ts` | The only file that calls the backend (`/api/status`, `/api/search`, `/api/records`). |
| `src/lib/schema.ts` | Ajv validation against `../shared/schemas/input.schema.json` and `output.schema.json`. |
| `src/lib/recordAdapter.ts` | Checks the per-test records from `/api/records` before the charts use them. |
| `src/lib/records.ts` | Table values derived from per-test records. |
| `src/lib/chartData.ts` | Chart data. Groups values by quantity, unit and definition, so different measurements are never plotted together. |
| `src/lib/compare.ts` | Similarities and differences for a custom selection in the comparison table. |
| `src/state/SearchContext.tsx` | Shared state: filters (kept across both pages), result, selected experiments. |
| `src/types.ts` | Types for the input, output, records and backend responses. |
| `src/pages/` | Search page and results page. |
| `src/components/` | Sections of the results page. |

The charts plot only numbers from `/api/records`, never from text. If an investigation's table has no per-test values for a quantity (for example, BASS-II has no per-test spread rates), the chart says so.
