"""Flame in Freefall backend (Flask).

What it does
------------
1. Serves the built frontend (../frontend/dist) at http://127.0.0.1:5000
2. Answers the API the frontend calls (frontend/src/lib/api.ts):

   GET  /api/status                      -> live or saved-example mode, model, loaded investigations
   POST /api/search                      -> body {"input": <input.schema.json>, "research_question": str|null}
                                            returns {"output": <output.schema.json>, "meta": {...}}
   GET  /api/records?experiment_ids=A,B  -> {"records": [ExperimentRecord, ...]} per-test numbers for the charts
   GET  /api/schema/<input|output|investigation>

Run:  python app.py      (or double-click start.bat in the project folder)
Settings (API key, model): backend/.env
"""
import json
import os
import threading
import time
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory

BACKEND = Path(__file__).parent
load_dotenv(BACKEND / ".env")

import gemini_client as gc  # noqa: E402  (reads .env values, so load it first)
import pipeline as pl        # noqa: E402

FRONTEND_DIST = BACKEND.parent / "frontend" / "dist"
RUNS = BACKEND / "runs"
DEMO = BACKEND / "data" / "demo"
SYSTEM_PROMPT = (BACKEND / "prompts" / "system_prompt.md").read_text(encoding="utf-8")

app = Flask(__name__, static_folder=str(FRONTEND_DIST), static_url_path="")
app.json.sort_keys = False      # keep schema key order in responses
BUSY = threading.Lock()         # one Gemini search at a time


def model_name():
    return os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite").strip()


def has_key():
    return bool(os.environ.get("GEMINI_API_KEY", "").strip())


def same_search(a, b):
    """True if two inputs ask the same thing (ignores empty conditions and gravity 'All')."""
    def norm(q):
        q = dict(q or {})
        c = {k: v for k, v in (q.pop("conditions", None) or {}).items() if v not in (None, "All")}
        return {**q, **({"conditions": c} if c else {})}
    return norm(a) == norm(b)


def save_run(run_id, files):
    """Every search is logged in backend/runs/<run_id>/ for debugging."""
    folder = RUNS / run_id
    folder.mkdir(parents=True, exist_ok=True)
    for name, content in files.items():
        text = content if isinstance(content, str) else json.dumps(content, indent=2, ensure_ascii=False)
        (folder / name).write_text(text, encoding="utf-8")


# ============================================================== frontend
@app.get("/")
def index():
    if not (FRONTEND_DIST / "index.html").exists():
        return ("<h1>Frontend not built yet</h1><p>Run <b>build-frontend.bat</b> (or <code>npm run build</code> "
                "in the frontend folder), then reload this page. For development use <b>dev.bat</b>.</p>"), 503
    return send_from_directory(FRONTEND_DIST, "index.html")


# ============================================================== API
@app.get("/api/status")
def status():
    invs = pl.load_investigations()
    return jsonify({
        "mode": "live" if has_key() else "saved_example",
        "model": model_name() if has_key() else None,
        "report_mode": os.environ.get("REPORT_MODE", "text"),
        "investigations": [pl.summarize_investigation(i) for i in invs],
    })


@app.get("/api/schema/<name>")
def schema(name):
    if name not in ("input", "output", "investigation"):
        return jsonify({"error": "Unknown schema"}), 404
    return jsonify(pl.load_schema(name))


@app.get("/api/records")
def records():
    ids = [x.strip() for x in request.args.get("experiment_ids", "").split(",") if x.strip()]
    return jsonify({"records": pl.experiment_records(pl.load_investigations(), ids)})


@app.post("/api/search")
def search():
    body = request.get_json(silent=True) or {}
    query = body.get("input")
    research_question = body.get("research_question")   # stored with the run; reserved for the future chat
    report_mode = body.get("report_mode") or os.environ.get("REPORT_MODE", "text")
    if report_mode not in ("pdf", "text", "none"):
        return jsonify({"error": "report_mode must be pdf, text or none"}), 400

    errors = pl.validate_query(query if isinstance(query, dict) else {})
    if errors:
        return jsonify({"error": "The input does not match input.schema.json.", "details": errors}), 400

    invs = pl.load_investigations()
    if not invs:
        return jsonify({"error": "No investigation records found in backend/data/psi/."}), 500
    prescores = pl.prescore_all(invs, query)
    run_id = datetime.now().strftime("%Y%m%d-%H%M%S-%f")[:-3]
    run_input = {"input": query, "research_question": research_question, "report_mode": report_mode}

    # ---- no API key: return the saved example (real data, prepared offline for the sample query)
    if not has_key():
        output = json.loads((DEMO / "demo_output.json").read_text(encoding="utf-8"))
        meta = {"mode": "saved_example", "model": None, "run_id": run_id,
                "query_matches_example": same_search(query, json.loads((DEMO / "demo_query.json").read_text(encoding="utf-8"))),
                "valid": True, "validation_errors": pl.validate_output(output), "integrity_notes": [],
                "duration_s": 0, "log": ["No GEMINI_API_KEY in backend/.env: returned the saved example."]}
        save_run(run_id, {"input.json": run_input, "output.json": output, "meta.json": meta})
        return jsonify({"output": output, "meta": meta})

    # ---- live: Gemini
    if not BUSY.acquire(blocking=False):
        return jsonify({"error": "A search is already running. Wait for it to finish, then try again."}), 409
    log_lines, t0, model = [], time.time(), model_name()

    def log(msg):
        log_lines.append(f"{time.strftime('%H:%M:%S')} {msg}")
        print(msg, flush=True)

    try:
        head, record_blocks, tail = pl.build_text_blocks(invs, query, prescores)
        parts, inputs_used = [{"text": head}], []
        for inv in invs:
            parts.append({"text": record_blocks[inv["psi_id"]]})
            inputs_used.append(f"{inv['psi_id']}/record.json")
            if report_mode != "none":
                parts += gc.report_parts(inv["psi_id"], inv["reports"], report_mode, log, query)
                inputs_used += [f"{inv['psi_id']}/reports/{p.name}" for p in inv["reports"]]
        parts.append({"text": tail})

        schema_for_gemini = pl.gemini_schema()
        text, schema_mode, usage, model = gc.generate(model, SYSTEM_PROMPT, parts, schema_for_gemini, log)
        attempts = 1
        try:
            output, notes = pl.ground_output(gc.parse_json(text), invs, query, inputs_used)
            errors = pl.validate_output(output)
        except (json.JSONDecodeError, ValueError) as e:
            output, notes, errors = None, [], [f"Response was not valid JSON: {e}"]
        if errors:
            log(f"Answer failed the output schema ({len(errors)} errors); asking Gemini to repair it once")
            attempts = 2
            text, _, _, _ = gc.repair(model, text, errors, schema_for_gemini, log)
            output, notes = pl.ground_output(gc.parse_json(text), invs, query, inputs_used)
            errors = pl.validate_output(output)
    except gc.GeminiError as e:
        save_run(run_id, {"input.json": run_input, "error.txt": str(e), "log.txt": "\n".join(log_lines)})
        return jsonify({"error": str(e), "details": log_lines}), 502
    except Exception as e:  # noqa: BLE001  (show unexpected errors in the UI during development)
        save_run(run_id, {"input.json": run_input, "error.txt": repr(e), "log.txt": "\n".join(log_lines)})
        return jsonify({"error": f"Unexpected error: {e!r}", "details": log_lines}), 500
    finally:
        BUSY.release()

    meta = {"mode": "live", "model": model, "run_id": run_id, "schema_mode": schema_mode, "report_mode": report_mode,
            "attempts": attempts, "valid": not errors, "validation_errors": errors, "integrity_notes": notes,
            "usage": usage, "duration_s": round(time.time() - t0, 1), "log": log_lines}
    save_run(run_id, {"input.json": run_input, "raw_response.txt": text, "output.json": output, "meta.json": meta})
    return jsonify({"output": output, "meta": meta})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    print(f"Flame in Freefall: http://127.0.0.1:{port}  "
          f"({'live, ' + model_name() if has_key() else 'saved example, no API key in backend/.env'})")
    if not (FRONTEND_DIST / "index.html").exists():
        print("Note: frontend/dist is missing. Run build-frontend.bat, or use dev.bat while developing.")
    app.run(host="127.0.0.1", port=port, debug=False, threaded=True)
