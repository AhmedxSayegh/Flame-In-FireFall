# Flame in Freefall — integrated team frontend

The team's React/TypeScript interface is connected to the existing Flask research backend. The visual design is preserved; searches use backend results and real numeric records, with no demo fallback.

Open the built application at **http://127.0.0.1:5000** while the backend is running.

From the repository root:

```powershell
.\.venv\Scripts\python.exe backend\app.py
```

For frontend development, in another terminal:

```powershell
cd frontend
npm.cmd run dev
```

Vite serves http://localhost:5173 and proxies `/api` to port 5000. No frontend `.env` is required for this default. Optional `VITE_API_BASE_URL` is a public API address, never a Gemini credential.

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

See [the actual integration contracts](INTEGRATION.md) and [the pre-animation publication report](../docs/PRE_ANIMATION_PUBLICATION.md).

This branch keeps Experiment / Comparison / Evidence navigation, investigation-selection strips, globally scoped experiment dropdowns, and the removed research-question UI. It excludes the later Animation workspace.
