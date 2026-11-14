"""Backend logic that does not talk to the network:
loading investigation records, scoring, building the Gemini prompt, checking
Gemini's answer, and building per-test records for the frontend charts.

Network calls to Gemini live in gemini_client.py. HTTP routes live in app.py.
"""
import copy
import json
import os
import re
from pathlib import Path

import jsonschema

ROOT = Path(__file__).parent                       # .../flame-in-freefall/backend
DATA = ROOT / "data" / "psi"                       # one folder per investigation
SCHEMAS = ROOT.parent / "shared" / "schemas"       # shared with the frontend


def load_schema(name):
    """name is 'input', 'output' or 'investigation' -> shared/schemas/<name>.schema.json"""
    return json.loads((SCHEMAS / f"{name}.schema.json").read_text(encoding="utf-8"))


QUERY_SCHEMA = load_schema("input")
OUTPUT_SCHEMA = load_schema("output")


# ---------------------------------------------------------------- records

def load_investigations():
    """Each folder in data/psi/ holds record.json and an optional reports/ folder."""
    out = []
    for folder in sorted(p for p in DATA.iterdir() if p.is_dir()):
        rec_path = folder / "record.json"
        if not rec_path.exists():
            continue
        record = json.loads(rec_path.read_text(encoding="utf-8"))
        reports = sorted((folder / "reports").glob("*.pdf")) if (folder / "reports").exists() else []
        out.append({"folder": folder, "record": record, "reports": reports,
                    "psi_id": record["investigation"]["psi_id"]})
    return out


def summarize_investigation(inv):
    r = inv["record"]["investigation"]
    return {
        "psi_id": r["psi_id"], "title": r.get("title"), "acronym": r.get("acronym"),
        "reference_link": r.get("reference_link"),
        "experiments": len(inv["record"].get("condition_sets", [])),
        "reports": [{"name": p.name, "mb": round(p.stat().st_size / 1e6, 1)} for p in inv["reports"]],
    }


# ---------------------------------------------------------------- query

def validate_query(query):
    v = jsonschema.Draft202012Validator(QUERY_SCHEMA)
    return [f"{'/'.join(map(str, e.path)) or 'query'}: {e.message}" for e in v.iter_errors(query)]


def is_filter(value):
    return value is not None and not (isinstance(value, str) and value.startswith("All"))


# ---------------------------------------------------------------- scoring
# Deterministic relevance score passed to the model so the ranking is repeatable.

def _tag_score(tags, wanted, use_basis=False):
    if not tags:
        return None, "unknown (not reported)"
    for t in tags:
        if t.get("value") == wanted:
            if use_basis and t.get("basis") == "inferred":
                return 0.5, "partial (inferred)"
            return 1.0, "match"
    return 0.0, "no match"


def _range_score(rng, target):
    if not rng or rng.get("min") is None or rng.get("max") is None:
        return None, "unknown (not reported)"
    lo, hi = rng["min"], rng["max"]
    if lo <= target <= hi:
        return 1.0, f"match (tested {lo}-{hi})"
    dist = (lo - target) if target < lo else (target - hi)
    s = max(0.0, 1 - dist / (0.5 * max(abs(target), 1e-9)))
    return round(s, 2), (f"partial (tested {lo}-{hi})" if s > 0 else f"no match (tested {lo}-{hi})")


def prescore(record, query):
    parts = {}
    if is_filter(query.get("crew_environment")):
        parts["crew_environment"] = _tag_score(record.get("crew_environments"), query["crew_environment"], True)
    if is_filter(query.get("fire_safety_category")):
        parts["fire_safety_category"] = _tag_score(record.get("fire_safety_categories"), query["fire_safety_category"])
    if is_filter(query.get("research_topic")):
        parts["research_topic"] = _tag_score(record.get("research_topics"), query["research_topic"])
    if is_filter(query.get("investigation")):
        inv = record["investigation"]
        hit = query["investigation"] in (inv.get("program"), inv.get("acronym"))
        parts["investigation"] = (1.0 if hit else 0.0, "match" if hit else "no match")
    if is_filter(query.get("fuel_type")):
        types = record.get("fuel", {}).get("types") or []
        parts["fuel_type"] = ((1.0, "match") if query["fuel_type"] in types
                              else (0.0, "no match") if types else (None, "unknown (not reported)"))
    if is_filter(query.get("measurement_type")):
        parts["measurement_type"] = _tag_score(record.get("measurement_types"), query["measurement_type"])
    cond = query.get("conditions") or {}
    rc = record.get("conditions", {})
    for key, field in (("oxygen_pct", "oxygen_concentration"), ("pressure_kpa", "pressure"),
                       ("airflow_cm_s", "airflow_velocity")):
        if cond.get(key) is not None:
            parts[key.split("_")[0] if key != "airflow_cm_s" else "airflow"] = _range_score(rc.get(field), cond[key])
    if is_filter(cond.get("gravity_level")):
        vals = (rc.get("gravity_level") or {}).get("values") or []
        g = cond["gravity_level"]
        if not vals:
            parts["gravity"] = (None, "unknown (not reported)")
        elif g in vals:
            parts["gravity"] = (1.0, "match")
        elif g == "microgravity" and "simulated microgravity" in vals:
            parts["gravity"] = (0.5, "partial (simulated)")
        else:
            parts["gravity"] = (0.0, "no match")
    scored = [s for s, _ in parts.values() if s is not None]
    score = round(100 * sum(scored) / len(scored)) if scored else 0
    return {"psi_id": record["investigation"]["psi_id"], "score": score,
            "filters_scored": len(scored), "filters_unknown": len(parts) - len(scored),
            "field_matches": {k: v for k, (_, v) in parts.items()}}


def prescore_all(investigations, query):
    scores = [prescore(i["record"], query) for i in investigations]
    return sorted(scores, key=lambda s: (-s["score"], s["psi_id"]))


# ---------------------------------------------------------------- prompt

def build_text_blocks(investigations, query, prescores):
    """Text parts of the request; report parts are added by gemini_client."""
    head = ("QUERY\n" + json.dumps(query, indent=2) +
            "\n\nPRESCORES (keep this order)\n" + json.dumps(prescores, indent=2))
    records = {i["psi_id"]: f"RECORD {i['psi_id']} (record.json)\n" + compact_record(i["record"], query)
               for i in investigations}
    tail = ("Return the JSON object now. Rank all " + str(len(investigations)) +
            " investigations, with up to 3 top experiments and a comparison for each.")
    return head, records, tail


# Reference cabin conditions used to rank experiments when the user picks a crew
# environment but no explicit conditions (lunar values from the Space Apps brief).
CREW_REFERENCE = {
    "Lunar Base": (30.0, 70.3), "Pressurized Rover": (30.0, 70.3),
    "Space Station": (21.0, 101.3), "Spacecraft": (21.0, 101.3),
}
SOLID_WORDS = ("pmma", "film", "slab", "rod", "fabric", "nomex", "sibal", "candle", "spherical", "solid")
LIQUID_WORDS = ("methanol", "heptane", "decane", "dodecane", "droplet", "liquid")
GAS_WORDS = ("gas", "propane", "methane", "ethylene", "jet", "burner")


def _fuel_class(cs):
    t = (str(cs.get("fuel", "")) + " " + str(cs.get("geometry", ""))).lower()
    if any(w in t for w in SOLID_WORDS):
        return "Solid Materials"
    if any(w in t for w in LIQUID_WORDS):
        return "Liquid Fuels"
    if any(w in t for w in GAS_WORDS):
        return "Gaseous Fuels"
    return None


def score_experiment(cs, query):
    """Rough relevance of one experiment (condition set) to the query, for pre-selection only."""
    import math
    score = 0.2 * math.log(1 + cs.get("n_tests", 1))
    if is_filter(query.get("fuel_type")):
        score += 2.0 if _fuel_class(cs) == query["fuel_type"] else -1.0
    cond = query.get("conditions") or {}
    ref = CREW_REFERENCE.get(query.get("crew_environment"))
    o2_t = cond.get("oxygen_pct", ref[0] if ref else None)
    p_t = cond.get("pressure_kpa", ref[1] if ref else None)
    if o2_t is not None and cs.get("oxygen_pct") is not None:
        score -= abs(cs["oxygen_pct"] - o2_t) / 8
    if p_t is not None and cs.get("pressure_kpa") is not None:
        score -= abs(cs["pressure_kpa"] - p_t) / 40
    events = " ".join(list((cs.get("outcomes") or {}).keys()) + list(cs.get("observed_events") or [])).lower()
    if query.get("measurement_type") == "Extinction Conditions" and "extinction" in events:
        score += 1.0
    if query.get("fire_safety_category") == "Fire Suppression":
        score += 1.0 if cs.get("suppressant", "none") != "none" else 0.0
    elif query.get("fire_safety_category") == "Fire Prevention":
        score += 0.5 if cs.get("suppressant", "none") == "none" else 0.0
    return score


def compact_record(record, query=None, keep=None):
    """Record as compact JSON for the prompt. Sends only the most relevant experiments
    (record.json on disk is unchanged) and drops fields the model does not need."""
    keep = keep or int(os.environ.get("EXPERIMENTS_PER_INVESTIGATION", "12"))
    r = copy.deepcopy(record)
    r.pop("tests", None)          # per-test table is for the charts, not for Gemini
    sets = r.get("condition_sets", [])
    if query is not None and len(sets) > keep:
        ranked = sorted(sets, key=lambda cs: -score_experiment(cs, query))
        chosen = {cs["set_id"] for cs in ranked[:keep]}
        r["condition_sets"] = [cs for cs in sets if cs["set_id"] in chosen]
        r["condition_sets_note"] = (f"{keep} of {len(sets)} experiments, pre-selected in code as most relevant "
                                    "to the query. Choose the top 3 from these.")
    for cs in r.get("condition_sets", []):
        cs.pop("test_dates", None)
        cs.pop("oxygen_initial_range_pct", None)
        if "flow_settings_raw" in cs:
            cs["flow_settings_raw"] = [" ".join(f.split())[:80] for f in cs["flow_settings_raw"]]
    return json.dumps(r, separators=(",", ":"), ensure_ascii=False)


KEYWORDS = {
    "Fire Prevention": ["flammab", "ignit", "limit", "material", "loi"],
    "Fire Detection": ["detect", "smoke", "sensor", "alarm"],
    "Fire Growth & Spread": ["spread", "growth", "flame size", "flame length"],
    "Fire Suppression": ["suppress", "extinguish", "co2", "helium", "agent"],
    "Material Flammability": ["flammab", "limit", "oxygen concentration", "minimum o2", "loi"],
    "Flame Spread": ["spread rate", "flame spread", "opposed", "concurrent"],
    "Smoke & Aerosols": ["smoke", "soot", "aerosol", "particle"],
    "Flame Extinction": ["extinction", "extinguish", "quench", "blowoff"],
    "Combustion Behavior": ["burning rate", "flame temperature", "radiat", "soot"],
    "Solid Materials": ["pmma", "solid", "fabric", "thick", "sample"],
    "Liquid Fuels": ["droplet", "methanol", "heptane", "liquid"],
    "Gaseous Fuels": ["gaseous", "jet", "burner", "propane"],
    "Flame Spread Rate": ["spread rate", "mm/s"],
    "Flame Size": ["flame size", "flame diameter", "standoff", "flame length"],
    "Burning Rate": ["burning rate", "regression"],
    "Extinction Conditions": ["extinction", "quench", "blowoff", "limit"],
    "Smoke Particle Size": ["particle size", "aerosol", "smoke"],
    "Detector Response": ["detector", "sensor", "alarm"],
    "Lunar Base": ["oxygen", "pressure", "lunar", "habitat", "eva"],
    "Pressurized Rover": ["oxygen", "pressure", "rover", "eva"],
    "Martian Base": ["mars", "martian", "pressure", "oxygen"],
    "Space Station": ["iss", "space station", "cabin"],
    "Spacecraft": ["spacecraft", "cabin", "ventilation"],
}
ALWAYS = ["conclusion", "summary", "abstract", "results", "objective"]


def select_report_pages(text, query, max_chars=None):
    """Keep only the report pages most relevant to the query (text marked with [page N])."""
    max_chars = max_chars or int(os.environ.get("REPORT_EXCERPT_CHARS", "60000"))
    pages = [(int(m.group(1)), m.group(2).strip()) for m in
             re.finditer(r"\[page (\d+)\]\n(.*?)(?=\n\[page \d+\]|\Z)", text, re.S)]
    if not pages:
        return text[:max_chars]
    words = list(ALWAYS)
    for key in ("fire_safety_category", "research_topic", "fuel_type", "measurement_type", "crew_environment"):
        words += KEYWORDS.get(query.get(key), [])
    scored = []
    for n, body in pages:
        low = body.lower()
        if len(low) < 200:
            continue
        hits = sum(min(low.count(w), 5) for w in words)
        scored.append((hits, n, body))
    scored.sort(key=lambda x: (-x[0], x[1]))
    chosen, total = [], 0
    for hits, n, body in scored:
        if hits == 0 or total + len(body) > max_chars:
            continue
        chosen.append((n, body))
        total += len(body)
    chosen.sort()
    return "\n".join(f"[page {n}]\n{b}" for n, b in chosen) or text[:max_chars]


# ---------------------------------------------------------------- after the model

# A field_matches value sometimes runs into the next field's key, e.g.
# "match (... p. 11.)ुरl_type: match (...)". This finds where the leaked key starts.
LEAKED_FIELD_KEY = re.compile(r"[^\x00-\x7f]*[a-z]*_(?:environment|category|topic|investigation|type)\s*:")


def ground_output(output, investigations, query, inputs_used):
    """Overwrite fields the model must copy, and list what was corrected."""
    notes = []
    out = copy.deepcopy(output)
    out["query"] = query
    out["inputs_used"] = inputs_used
    by_id = {i["psi_id"]: i["record"] for i in investigations}
    for item in out.get("ranked", []):
        rec = by_id.get(item.get("psi_id"))
        if rec is None:
            notes.append(f"Model ranked an unknown investigation: {item.get('psi_id')}")
            continue
        matches = item.get("field_matches") or {}
        for field, value in matches.items():
            leak = LEAKED_FIELD_KEY.search(value) if isinstance(value, str) else None
            if leak:
                value = value[:leak.start()].rstrip(" ;,")
                if "(" in value and not value.endswith(")"):
                    value += ")"
                matches[field] = value
                notes.append(f"{item['psi_id']}: field_matches.{field} ran into another field; trimmed")
        link = rec["investigation"].get("reference_link")
        if link and item.get("reference_link") != link:
            notes.append(f"{item['psi_id']}: reference_link replaced with the record's link")
            item["reference_link"] = link
        sets = {c["set_id"]: c for c in rec.get("condition_sets", [])}
        for exp in item.get("top_experiments", []):
            cs = sets.get(exp.get("experiment_id"))
            if cs is None:
                notes.append(f"{item['psi_id']}: experiment_id {exp.get('experiment_id')} is not in the record")
                continue
            if exp.get("tests") != cs["tests"]:
                notes.append(f"{exp['experiment_id']}: test list replaced with the record's tests")
                exp["tests"] = cs["tests"]
        comp = item.get("top_experiments_comparison") or {}
        for eid in comp.get("experiment_ids", []):
            if eid not in sets:
                notes.append(f"{item['psi_id']}: comparison uses unknown experiment {eid}")
    missing = set(by_id) - {i.get("psi_id") for i in out.get("ranked", [])}
    if missing:
        notes.append("Not ranked by the model: " + ", ".join(sorted(missing)))
    out.get("ranked", []).sort(key=lambda x: x.get("rank", 999))
    return out, notes


def validate_output(output):
    v = jsonschema.Draft202012Validator(OUTPUT_SCHEMA, format_checker=jsonschema.FormatChecker())
    errs = sorted(v.iter_errors(output), key=lambda e: list(e.path))
    return [f"{'/'.join(map(str, e.path)) or 'output'}: {e.message[:300]}" for e in errs][:30]


def gemini_schema(schema=None):
    """Copy of the output schema without keywords Gemini may not support."""
    schema = copy.deepcopy(schema or OUTPUT_SCHEMA)
    defs = schema.pop("$defs", {})
    drop = {"$schema", "$defs", "pattern", "examples", "default", "format", "title"}

    def walk(node):
        if isinstance(node, dict):
            if "$ref" in node and node["$ref"].startswith("#/$defs/"):
                target = copy.deepcopy(defs[node["$ref"].split("/")[-1]])
                node = {**{k: v for k, v in node.items() if k != "$ref"}, **target}
            return {k: walk(v) for k, v in node.items() if k not in drop}
        if isinstance(node, list):
            return [walk(v) for v in node]
        return node
    return walk(schema)


def env_flag(name, default="0"):
    return os.environ.get(name, default).strip().lower() in ("1", "true", "yes", "on")


# ---------------------------------------------------------------- records for the charts
# GET /api/records returns these. Shape = ExperimentRecord in frontend/src/types.ts.

def _sample_text(cs):
    if cs.get("mean_initial_diameter_mm") is not None:
        return f"Droplet, mean initial diameter {cs['mean_initial_diameter_mm']} mm"
    return (cs.get("geometry") or "").capitalize() or None


def experiment_records(investigations, ids):
    """Build one chart record per requested experiment ID (condition set)."""
    wanted, out = set(ids), []
    for inv in investigations:
        rec = inv["record"]
        meta = rec["investigation"]
        gravity = ((rec.get("conditions", {}).get("gravity_level") or {}).get("values") or [None])[0]
        sources = [{"label": f"{meta.get('acronym') or meta['psi_id']} dataset on NASA PSI ({meta['psi_id']})",
                    "url": meta.get("reference_link"), "kind": "dataset", "verified": True}]
        sources += [{"label": p.name, "kind": "report", "verified": True} for p in inv["reports"]]
        for cs in rec.get("condition_sets", []):
            if cs["set_id"] not in wanted:
                continue
            label = f"{cs['fuel']}, {cs.get('oxygen_pct')}% O2, {cs.get('pressure_kpa')} kPa"
            if cs.get("suppressant") not in (None, "none"):
                label += f", {cs['suppressant_pct']}% {cs['suppressant']}"
            tests = [{k: t.get(k) for k in ("test_number", "test_identifier", "oxygen_pct", "pressure_kpa",
                                             "airflow_cm_s", "outcome", "measurements")}
                     for t in rec.get("tests", []) if t.get("set_id") == cs["set_id"]]
            out.append({
                "experiment_id": cs["set_id"], "psi_id": meta["psi_id"],
                "investigation": meta.get("acronym") or meta.get("program") or meta["psi_id"],
                "label": label, "fuel": cs.get("fuel"), "fuel_type": _fuel_class(cs),
                "sample": _sample_text(cs), "gravity": gravity, "tests": tests, "sources": sources,
            })
    return out
