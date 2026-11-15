"""Backend logic that does not talk to the network:
loading investigation records, scoring, building the Gemini prompt, checking
Gemini's answer, and building per-test records for the frontend charts.

Network calls to Gemini live in gemini_client.py. HTTP routes live in app.py.
"""
from collections import Counter
import copy
import json
import math
import os
import re
from urllib.parse import quote
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
            quantity = key.split("_")[0]
            psi_id = record["investigation"]["psi_id"]
            if key == "airflow_cm_s" and psi_id in {"PSI-25", "PSI-69"}:
                parts[quantity] = (None, "unknown (no comparable run-level airflow)")
            elif key == "pressure_kpa" and psi_id == "PSI-25":
                parts[quantity] = (None, "unknown (nominal cabin pressure only)")
            else:
                parts[quantity] = _range_score(rc.get(field), cond[key])
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
    score = 0.2 * math.log(1 + cs.get("n_tests", 1))
    if is_filter(query.get("fuel_type")):
        score += 2.0 if _fuel_class(cs) == query["fuel_type"] else -1.0
    cond = query.get("conditions") or {}
    ref = CREW_REFERENCE.get(query.get("crew_environment"))
    o2_t, p_t = cond.get("oxygen_pct"), cond.get("pressure_kpa")
    if ref:
        o2_t = ref[0] if o2_t is None else o2_t
        p_t = ref[1] if p_t is None else p_t
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


def bounded_setting(name, default, minimum, maximum):
    """Use the default for unset, blank, or invalid optional integer settings."""
    try:
        value = int(os.environ.get(name, ""))
    except ValueError:
        value = default
    return min(maximum, max(minimum, value))


def candidate_sets(record, query, keep=None):
    if keep is None:
        keep = bounded_setting("EXPERIMENTS_PER_INVESTIGATION", 6, 3, 12)
    return sorted(record.get("condition_sets", []),
                  key=lambda cs: (-score_experiment(cs, query), cs["set_id"]))[:keep]


def compact_record(record, query=None, keep=None):
    """Send candidate IDs and sourced summaries, without repeating individual run data."""
    candidates = candidate_sets(record, query or {}, keep)
    rows = tests_by_set(record)
    metadata = record["investigation"]
    compact = {"investigation": {key: metadata[key] for key in
                                 ("psi_id", "title", "acronym", "platform") if key in metadata}}
    for field in ("crew_environments", "fire_safety_categories", "research_topics", "measurement_types"):
        compact[field] = [{key: tag[key] for key in ("value", "basis") if key in tag}
                          for tag in record.get(field, [])]
    for field in ("key_findings", "notes"):
        compact[field] = record.get(field, [])
    compact["condition_sets"] = [
        {"set_id": cs["set_id"], "conditions_and_results": set_attributes(cs, rows.get(cs["set_id"], []))}
        for cs in candidates
    ]
    return json.dumps(compact, separators=(",", ":"), ensure_ascii=False)


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


def select_report_pages(text, query, max_chars, preferred_pages=()):
    """Fit complete page markers and bounded excerpts into the supplied character budget."""
    pages = [(int(m.group(1)), m.group(2).strip()) for m in
             re.finditer(r"\[page (\d+)\]\n(.*?)(?=\n\[page \d+\]|\Z)", text, re.S)]
    words = list(ALWAYS)
    for key in ("fire_safety_category", "research_topic", "fuel_type", "measurement_type", "crew_environment"):
        words += KEYWORDS.get(query.get(key), [])
    priorities = {page: i for i, page in enumerate(preferred_pages)}
    ranked = sorted(
        ((n, body) for n, body in pages if body),
        key=lambda page: (priorities.get(page[0], len(priorities)),
                          -sum(min(page[1].lower().count(w), 5) for w in words), page[0]),
    )
    chosen = []
    for n, body in ranked:
        marker = f"[page {n}]\n"
        remaining = max_chars - len(marker) - bool(chosen)
        if remaining <= 0:
            break
        excerpt = body[:min(remaining, 2400)]
        chosen.append((n, marker + excerpt))
        max_chars -= len(marker) + len(excerpt) + (len(chosen) > 1)
    return "\n".join(part for _, part in sorted(chosen))


# ---------------------------------------------------------------- after the model

# Page numbers are physical PDF pages. Appendix rows were checked against the
# transcribed test numbers and sample identifiers. Section results have wider scope.
BASS_REPORT = "BASS-II_Summary_Report.pdf"
BASS_EVIDENCE = (
    (21, (), "Thin PMMA films",
     "A 100 µm film reached a steady spread rate of 2.2 mm/s before flow cutoff. "
     "In a separate test, the estimated flow at extinction was about 1.1 cm/s."),
    (54, (), "Nomex samples",
     "The three Nomex samples in the report did not ignite."),
    (58, (), "Black PMMA rods",
     "Spread was observed at oxygen concentrations as low as 17.5% in microgravity. "
     "The normal-gravity comparison observed no spread below 19%."),
    (83, (), "PMMA rod flammability boundary",
     "The fitted boundary reached a minimum near 13.5% oxygen for the tested axial stagnation flow configuration."),
    (101, (), "SIBAL fabric across BASS and BASS-II",
     "The report gives concurrent-flow quenching speeds of 1–5 cm/s over its tested conditions, with higher quenching speeds at lower oxygen."),
    (111, (("B1", "sample 147"),), "B1 · Appendix A.1",
     "At 22.2% initial oxygen, the flame extinguished after the flow was turned off. Final CO was 6 ppm."),
    (112, (("B3", "sample 148"),), "B3 · Appendix A.1",
     "The calibrated initial oxygen entry is 22.2% and final CO was 19 ppm. The observation notes uncertainty about the starting oxygen."),
    (114, (("P13a", "sample 203m"), ("P13b", "sample 203m")), "P13a and P13b · Appendix A.3",
     "Both tests began at a reported 5 cm/s before flow reduction. Final CO was 450 ppm in P13a and 72 ppm in P13b."),
    (121, (("T25", "sample 138m"), ("T26", "sample 137m")), "T25 and T26 · Appendix A",
     "Both tests ignited at 5 cm/s before flow was set to 2.5 cm/s. Final CO was 17 ppm in T25 and 24 ppm in T26."),
)


def report_evidence(inv, sets):
    if inv["psi_id"] != "PSI-25" or not any(p.name == BASS_REPORT for p in inv["reports"]):
        return []
    ids = {(t["test_number"], t["test_identifier"]) for cs in sets for t in cs.get("tests", [])}
    return [
        {"title": title, "text": claim, "page": page, "test_numbers": [t[0] for t in tests],
         "url": f"/api/reports/PSI-25/{BASS_REPORT}#page={page}"}
        for page, tests, title, claim in BASS_EVIDENCE if not tests or ids.intersection(tests)
    ]


def ground_output(output, investigations, query, inputs_used, prescores=None, *, saved=False):
    """Model prose is optional enrichment around source-owned ranking and measurements."""
    if not isinstance(output, dict) or not isinstance(output.get("ranked"), list):
        raise ValueError("Expected a JSON object with a ranked array.")
    out = copy.deepcopy(output)
    out["query"], out["inputs_used"] = query, inputs_used
    notes, proposed = [], {}
    by_id = {i["psi_id"]: i for i in investigations}
    for item in out["ranked"]:
        psi_id = item.get("psi_id") if isinstance(item, dict) else None
        if not isinstance(psi_id, str) or psi_id not in by_id or psi_id in proposed:
            notes.append("Ignored an unknown, malformed, or duplicate investigation.")
            continue
        proposed[psi_id] = item

    out["ranked"] = []
    for rank, score in enumerate(prescores or prescore_all(investigations, query), 1):
        psi_id = score["psi_id"]
        inv = by_id[psi_id]
        rec = inv["record"]
        meta = rec["investigation"]
        item = proposed.get(psi_id, {})
        if not item:
            notes.append(f"{psi_id}: filled missing investigation from the record.")
        item.update(psi_id=psi_id, rank=rank, relevance_score=score["score"],
                    field_matches=score["field_matches"],
                    name=meta.get("title") or meta.get("acronym") or psi_id,
                    reference_link=meta.get("reference_link") or
                    f"https://science.nasa.gov/biological-physical/psi/{psi_id}/",
                    score_method=f"Deterministic score across {score['filters_scored']} known active filters"
                    f" ({score['filters_unknown']} unknown).")
        candidates = rec.get("condition_sets", []) if saved else candidate_sets(rec, query)
        sets = {cs["set_id"]: cs for cs in candidates}
        rows = tests_by_set(rec)
        top = {}
        selections = item.get("top_experiments")
        for exp in selections if isinstance(selections, list) else []:
            eid = exp.get("experiment_id") if isinstance(exp, dict) else None
            if not isinstance(eid, str) or eid not in sets or eid in top:
                notes.append(f"{psi_id}: ignored an invalid or duplicate experiment selection.")
                continue
            top[eid] = exp
            if len(top) == 3:
                break
        original_ids = list(top)
        for eid in sets:
            if len(top) == 3:
                break
            top.setdefault(eid, {"experiment_id": eid,
                                 "fire_safety_interpretation": "No model interpretation is available for this experiment."})
        attributes = {}
        for position, (eid, exp) in enumerate(top.items(), 1):
            cs, tests = sets[eid], rows.get(eid, [])
            attrs = attributes[eid] = set_attributes(cs, tests)
            for key in ("why_selected", "fire_safety_interpretation"):
                narrative = exp.get(key)
                if isinstance(narrative, str) and re.search(r"(?<![\w.])\d+(?:[.,]\d+)?\s*(?:%|ppm\b|cm/s\b|mm/s\b|mm²/s\b|kPa\b)", narrative, re.I):
                    notes.append(f"{eid}: omitted a quantitative claim from qualitative commentary.")
                    exp[key] = "See the recorded findings and linked sources for quantitative evidence."
            exp.update(rank=position, tests=cs.get("tests", []), experiment=set_label(cs),
                       summary_of_key_findings=" ".join(f"{key}: {attrs[key]}." for key in
                           ("Oxygen", "Pressure", "Airflow", "Tests", "Outcomes", "Measurements")),
                       evidence=[f"{psi_id} record.json · {eid} · condition_sets and test rows",
                                 *sorted({m["source"] for t in tests for m in t["measurements"] if m.get("source")})])
        item["top_experiments"] = list(top.values())
        item["report_evidence"] = report_evidence(inv, [sets[eid] for eid in top])
        runner_candidates = candidate_sets(rec, query) if saved else candidates
        runner_id = next((cs["set_id"] for cs in runner_candidates if cs["set_id"] not in top), None)
        item["runner_up"] = f"{runner_id}: {set_label(sets[runner_id])}" if runner_id else None
        comp = item.get("top_experiments_comparison")
        same_comparison = isinstance(comp, dict) and original_ids == list(top) and comp.get("experiment_ids") == list(top)
        if not same_comparison or saved:
            selected_runs = [t for eid in top for t in rows.get(eid, [])]
            measured = sum(bool(t["measurements"]) for t in selected_runs)
            outcomes = sum(bool(t["outcome"]) for t in selected_runs)
            comp = {"similarities": [], "differences": [],
                    "conclusion": f"The selected sets contain {len(selected_runs)} linked runs. "
                    f"{outcomes} have a recorded outcome and {measured} have a numeric measurement. "
                    "The comparison is limited to these conditions and source definitions."}
        comp.update(experiment_ids=list(top), compared_on=[
            {"attribute": key, "values": {eid: attrs[key] for eid, attrs in attributes.items()}}
            for key in next(iter(attributes.values()), {})
        ])
        item["top_experiments_comparison"] = comp
        out["ranked"].append(item)
    return out, notes


def validate_output(output):
    v = jsonschema.Draft202012Validator(OUTPUT_SCHEMA, format_checker=jsonschema.FormatChecker())
    errs = sorted(v.iter_errors(output), key=lambda e: tuple(map(str, e.path)))
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
    schema = walk(schema)
    # These fields are filled from the records, so the model need not echo them.
    def remove(obj, *keys):
        obj["required"] = [key for key in obj["required"] if key not in keys]
        for key in keys:
            obj["properties"].pop(key, None)
    remove(schema, "query", "inputs_used")
    item = schema["properties"]["ranked"]["items"]
    remove(item, "name", "reference_link", "rank", "relevance_score", "field_matches", "score_method", "runner_up", "report_evidence")
    remove(item["properties"]["top_experiments"]["items"], "rank", "tests", "experiment",
           "summary_of_key_findings", "evidence")
    remove(item["properties"]["top_experiments_comparison"], "compared_on")
    return schema


def env_flag(name, default="0"):
    return os.environ.get(name, default).strip().lower() in ("1", "true", "yes", "on")


# ---------------------------------------------------------------- records for the charts
# GET /api/records returns these. Shape = ExperimentRecord in frontend/src/types.ts.

def _sample_text(cs):
    if cs.get("mean_initial_diameter_mm") is not None:
        return f"Droplet, mean initial diameter {cs['mean_initial_diameter_mm']} mm"
    return (cs.get("geometry") or "").capitalize() or None


def is_number(value):
    return type(value) in (int, float) and math.isfinite(value)


def tests_by_set(record):
    """Project source rows onto the API contract without inferring missing measurements."""
    groups = {}
    # Membership is defined by both source identifiers, even for reused sample names.
    membership = {(t["test_number"], t["test_identifier"]): cs["set_id"]
                  for cs in record.get("condition_sets", []) for t in cs.get("tests", [])}
    nominal_pressure = record.get("investigation", {}).get("psi_id") == "PSI-25"
    seen = set()
    for t in record.get("tests", []):
        key = (t["test_number"], t["test_identifier"])
        eid = membership.get(key)
        if eid is None or key in seen:
            continue
        seen.add(key)
        row = {k: t.get(k) for k in ("test_number", "test_identifier", "oxygen_pct", "pressure_kpa",
                                      "airflow_cm_s", "outcome")}
        for field in ("oxygen_pct", "pressure_kpa", "airflow_cm_s"):
            if not is_number(row[field]):
                row[field] = None
        if nominal_pressure:
            row["pressure_kpa"] = None
        measurements = []
        for m in t.get("measurements") or []:
            if not is_number(m.get("value")) or not m.get("unit") or not m.get("definition"):
                continue
            m = dict(m)
            if m["quantity"] == "extinction_condition" and m["definition"] == "Visible flame extinction diameter" and m["value"] <= 0:
                continue
            if m["quantity"] == "burning_rate" and "PSI-69_Experimental_table_FLEX" in (m.get("source") or ""):
                m.update(unit="unconfirmed", definition="FLEX table burning-rate column (source label: mm; physical unit unconfirmed)")
            measurements.append(m)
        row["measurements"] = measurements
        groups.setdefault(eid, []).append(row)
    return groups


def set_label(cs):
    parts = [cs.get("fuel") or cs["set_id"]]
    if is_number(cs.get("oxygen_pct")):
        parts.append(f"~{cs['oxygen_pct']:g}% O₂ group")
    if cs.get("suppressant") not in (None, "none"):
        parts.append(f"{cs['suppressant_pct']:g}% {cs['suppressant']}")
    return ", ".join(parts)


def set_attributes(cs, tests):
    def span(field, unit):
        values = [t[field] for t in tests if t[field] is not None]
        if not values:
            return "not reported per run"
        lo, hi = min(values), max(values)
        value = f"{lo:g}" if lo == hi else f"{lo:g}–{hi:g}"
        return f"{value} {unit} ({len(values)}/{len(tests)} runs)"

    groups = {}
    for t in tests:
        for m in t["measurements"]:
            key = (m["quantity"], m["unit"], m["definition"])
            groups.setdefault(key, {}).setdefault((t["test_number"], t["test_identifier"]), m["value"])
    measurements = []
    for (quantity, unit, definition), by_run in groups.items():
        values = list(by_run.values())
        label = definition if unit == "unconfirmed" else f"{quantity.replace('_', ' ')} ({definition})"
        suffix = "" if unit == "unconfirmed" else f" {unit}"
        measurements.append(f"{label}: mean {sum(values)/len(values):.3g}{suffix}, "
                            f"range {min(values):g}–{max(values):g}{suffix} ({len(values)}/{len(tests)} runs)")
    counts = Counter(t["outcome"] for t in tests if t["outcome"])
    outcomes = ", ".join(f"{label} ×{n}" for label, n in counts.items())
    missing = len(tests) - sum(counts.values())
    if missing:
        outcomes = ", ".join(filter(None, (outcomes, f"not reported ×{missing}")))
    return {"Fuel": cs.get("fuel") or "not reported", "Oxygen": span("oxygen_pct", "% by volume"),
            "Pressure": span("pressure_kpa", "kPa"), "Airflow": span("airflow_cm_s", "cm/s"),
            "Tests": str(len(cs.get("tests", []))), "Outcomes": outcomes or "not reported",
            "Measurements": "; ".join(measurements) or "not reported per run"}


def experiment_records(investigations, ids):
    """Build one chart record per requested experiment ID (condition set)."""
    wanted, out = set(ids), []
    for inv in investigations:
        rec = inv["record"]
        meta = rec["investigation"]
        gravity = ((rec.get("conditions", {}).get("gravity_level") or {}).get("values") or [None])[0]
        sources = [{"label": f"{meta.get('acronym') or meta['psi_id']} dataset on NASA PSI ({meta['psi_id']})",
                    "url": meta.get("reference_link"), "kind": "dataset", "verified": True}]
        sources += [{"label": p.name, "kind": "report", "verified": True,
                     "url": f"/api/reports/{quote(inv['psi_id'])}/{quote(p.name)}"} for p in inv["reports"]]
        rows = tests_by_set(rec)
        for cs in rec.get("condition_sets", []):
            if cs["set_id"] not in wanted:
                continue
            out.append({
                "experiment_id": cs["set_id"], "psi_id": meta["psi_id"],
                "investigation": meta.get("acronym") or meta.get("program") or meta["psi_id"],
                "label": set_label(cs), "fuel": cs.get("fuel"), "fuel_type": _fuel_class(cs),
                "sample": _sample_text(cs), "gravity": gravity, "tests": rows.get(cs["set_id"], []),
                "sources": sources,
            })
    return out
