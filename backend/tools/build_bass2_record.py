"""Build the fire-safety JSON record for PSI-25 (BASS-II) from its PSI files.

Numbers come from code (transcribed experiment table + metadata). Category and
topic tags, and report findings, are in CURATED with page evidence (PDF pages of
the BASS-II Summary Report, NASA/TM-20210011385). In the full pipeline,
CURATED is what the Gemini extraction step produces and a human checks.

Usage:
  python build_bass2_record.py <experiment_table.csv> <i_Investigation.txt> <out.json>
"""
import json
import re
import sys

import pandas as pd

PSI_ID = "PSI-25"
TABLE = "PSI-25_Experimental_table_BASS-II_transcribed.csv"
META = "PSI-25 metadata (i_Investigation.txt)"
REPORT = "BASS-II_Summary_Report.pdf (NASA/TM-20210011385, 2021)"
O2_VALID = (10.0, 25.0)   # anything outside is a transcription or sensor error


def load_meta(path):
    meta = {}
    for line in open(path, encoding="utf-8", errors="replace"):
        parts = line.rstrip("\n").split("\t")
        if len(parts) > 1 and parts[0].strip():
            meta[parts[0].strip()] = parts[1].strip().strip('"')
    return meta


def num(x):
    try:
        return float(str(x).strip())
    except ValueError:
        return None


def classify_material(s):
    """Normalise the free-text 'Fuel Sample Material' column."""
    t = " ".join(str(s).replace('"', " in ").split()).lower()
    if "nomex" in t:
        return "Nomex III fabric", "fabric sheet"
    if "candle" in t:
        return "Wax candle (BASS-I leftover)", "candle"
    if "sibal" in t:
        w = re.search(r"(\d+)\s*cm", t)
        return f"SIBAL cotton-fiberglass fabric, {w.group(1)} cm wide" if w else "SIBAL fabric", "fabric sheet"
    if "spherical" in t:
        return "Spherical section sample, 4 cm", "spherical section"
    if "rod" in t:
        d = re.search(r"(1/4|3/8|1/2|0\.5)", t)
        size = {"0.5": "1/2"}.get(d.group(1), d.group(1)) if d else "?"
        color = "black" if "black" in t or "blac" in t else "clear"
        return f"PMMA rod {size} in, {color}", "rod"
    # films and slabs
    um = re.search(r"(\d+)\s*micron", t)
    mm = re.search(r"(\d*\.?\d+)\s*mm", t)
    thick = float(um.group(1)) / 1000 if um else (float(mm.group(1)) if mm else None)
    w = re.search(r"(\d+)\s*cm", t)
    width = f", {w.group(1)} cm wide" if w else ""
    sides = ", 2-sided" if "2 sided" in t else (", 1-sided" if "1 sided" in t else "")
    if thick is None:
        return "PMMA (unspecified)", "sheet"
    kind = "film" if thick < 1 else "slab"
    return f"PMMA {kind} {thick:g} mm{width}{sides}", kind


def events(*texts):
    t = " ".join(str(x).lower() for x in texts)
    ev = []
    if "no ign" in t or "would not stay lit" in t:
        ev.append("no sustained ignition")
    if "blowoff" in t:
        ev.append("blowoff extinction")
    if re.search(r"\bext\b|ext\b|extinguish|\bout\b", t):
        ev.append("extinction (flow reduced)")
    return ev


def load_table(path):
    df = pd.read_csv(path, dtype=str).fillna("")
    df.columns = [c.strip() for c in df.columns]
    df = df.rename(columns={
        "Test #": "test", "Sample #": "sample", "Fuel Sample Material": "material_raw",
        "Fan display": "fan", "Air display": "air", "Date": "date", "PI": "pi",
        "Calibrated  initial O2 % by vol": "o2_i", "Calibrated final O2 % by vol": "o2_f",
        "Initial CO2 % by vol": "co2_i", "Final CO2 % by vol": "co2_f",
        "Initial CO (ppm)": "co_i", "Final CO (ppm)": "co_f"})
    for c in ["o2_i", "o2_f", "co2_i", "co2_f", "co_i", "co_f"]:
        df[c + "_n"] = df[c].map(num)
    df[["material", "geometry"]] = df.material_raw.apply(lambda s: pd.Series(classify_material(s)))
    df["events"] = df.apply(lambda r: events(r.fan, r.air), axis=1)
    df["o2_bin"] = df.o2_i_n.round()
    return df


def r(x, n=1):
    return None if x is None or pd.isna(x) else round(float(x), n)


def condition_sets(df):
    out = []
    groups = df.groupby(["pi", "material", "o2_bin"], sort=True)
    for i, ((pi, mat, o2), g) in enumerate(groups, start=1):
        ev = sorted({e for lst in g.events for e in lst})
        out.append({
            "set_id": f"{PSI_ID}-CS{i:02d}",
            "tests": [{"test_number": t, "test_identifier": f"sample {s}"} for t, s in zip(g.test, g["sample"])],
            "principal_investigator": pi,
            "fuel": mat,
            "geometry": g.geometry.iloc[0],
            "oxygen_pct": r(o2, 0),
            "oxygen_initial_range_pct": [r(g.o2_i_n.min()), r(g.o2_i_n.max())],
            "pressure_kpa": 101.3,
            "n_tests": int(len(g)),
            "flow_settings_raw": [f"fan: {f} | air: {a}".strip() for f, a in zip(g.fan, g.air)],
            "observed_events": ev,
            "test_dates": sorted(set(g.date)),
        })
    return out


def test_rows(df, sets):
    """One row per test run. The transcribed table has no per-test spread rates, so
    measurements is empty; outcome comes from keywords in the free-text flow notes."""
    set_of = {t["test_number"]: cs["set_id"] for cs in sets for t in cs["tests"]}
    rows = []
    for _, t in df.iterrows():
        o2 = t.o2_i_n if t.o2_i_n is not None and O2_VALID[0] <= t.o2_i_n <= O2_VALID[1] else None
        rows.append({
            "test_number": t.test, "test_identifier": f"sample {t['sample']}", "set_id": set_of.get(t.test),
            "oxygen_pct": r(o2), "pressure_kpa": 101.3, "airflow_cm_s": None,
            "outcome": "; ".join(t.events).capitalize() if t.events else None,
            "material": t.material, "measurements": [],
        })
    return rows


def data_issues(df):
    issues = []
    bad = df[(df.o2_f_n.notna()) & ((df.o2_f_n < O2_VALID[0]) | (df.o2_f_n > O2_VALID[1]))]
    if len(bad):
        issues.append("Impossible final O2 readings (transcription/sensor errors), ignored: "
                      + ", ".join(f"{t}={v}" for t, v in zip(bad.test, bad.o2_f)))
    y = df[df.date.str.contains("2018")]
    if len(y):
        issues.append("Dates in 2018 for " + ", ".join(y.test) + "; GMT day matches 2014 tests, probably a typo.")
    over = df[df.co_f.str.contains("OR|over|>", case=False)]
    if len(over):
        issues.append("Final CO over sensor range for " + ", ".join(over.test) + ".")
    issues.append(f"Table has {len(df)} rows; the report states 126 tests (some samples were burned more than once, p. 11).")
    issues.append("Flow speeds are free-text fan/air display sequences; kept raw, not converted to cm/s.")
    return issues


def computed_findings(df):
    v = df[df.o2_i_n.between(*O2_VALID)]
    f = []
    bands = pd.cut(v.o2_i_n, [0, 16, 19, 30], labels=["<16%", "16-19%", ">=19%"], right=False)
    f.append({
        "finding": f"Initial O2 ranged {v.o2_i_n.min()}-{v.o2_i_n.max()}% (reduced by N2 dilution from ISS air); most tests were below 19% O2.",
        "data": {"tests_by_initial_o2": bands.value_counts().sort_index().to_dict(),
                 "tests_by_geometry": v.geometry.value_counts().to_dict()},
        "method": "Calibrated initial O2 column; values outside 10-25% excluded.",
        "source": TABLE,
    })
    low = v[v.o2_i_n < 15.5].sort_values("o2_i_n")
    f.append({
        "finding": "Lowest-O2 tests were almost all PMMA rods; one sample failed to ignite at 13.6% O2, while flames ignited higher survived down to final readings of about 13.6%.",
        "data": [{"test": t, "material": m, "o2_initial": a, "o2_final": b, "events": e}
                 for t, m, a, b, e in zip(low.test, low.material, low.o2_i, low.o2_f, low.events)],
        "method": "Tests with initial O2 < 15.5%.",
        "source": f"{TABLE}; {REPORT} p. 97",
    })
    co = v[v.co_f_n.notna()]
    top = co.sort_values("co_f_n", ascending=False).head(3)
    f.append({
        "finding": f"Final CO in the 250 L glovebox reached up to {int(co.co_f_n.max())} ppm (sensor over range in some tests); thick PMMA and rods gave the highest values.",
        "data": {"highest_final_co_ppm": {t: f"{int(c)} ({m})" for t, c, m in zip(top.test, top.co_f_n, top.material)},
                 "tests_over_range": list(df[df.co_f.str.contains("OR|over|>", case=False)].test)},
        "method": "Max of 'Final CO (ppm)' numeric values.",
        "source": f"{TABLE}; context {REPORT} p. 16",
    })
    ev = pd.Series([e for lst in df.events for e in lst]).value_counts().to_dict()
    f.append({
        "finding": "Many tests deliberately ran the flow down to extinction to map limits; blowoff and no-ignition outcomes were also recorded.",
        "data": {"tests_with_event": ev},
        "method": "Keywords ('ext', 'blowoff', 'no ign', 'would not stay lit') in fan/air display text. Text was transcribed, so counts are approximate.",
        "source": TABLE,
    })
    return f


CURATED = {
    "crew_environments": [
        {"value": "Space Station", "basis": "stated",
         "justification": "Flown on the ISS; Nomex was tested because it is heavily used aboard the ISS as a fire barrier (report p. 54)."},
        {"value": "Spacecraft", "basis": "stated",
         "justification": "Aims to find the worst case for material flammability in spacecraft environments and compare it with the NASA-STD-6001 upward test (report p. 11)."},
    ],
    "fire_safety_categories": [
        {"value": "Fire Prevention",
         "evidence": {"text": "Find the minimum O2 or flow at which a material burns in space; helps engineers select the safest materials.", "source": f"{REPORT} p. 11; {META} Research Impacts"}},
        {"value": "Fire Growth & Spread",
         "evidence": {"text": "Flame growth rates studied to see how quickly a fire in space can grow and whether flames reach a finite size.", "source": f"{REPORT} p. 11"}},
        {"value": "Fire Suppression",
         "evidence": {"text": "Results feed models used to design fire detection and suppression systems; flows reduced until flames quenched.", "source": f"{META} Objective; {REPORT} p. 101"}},
    ],
    "research_topics": [
        {"value": "Material Flammability", "evidence": {"text": "Flammability boundary for PMMA rods; minimum about 13.5% O2.", "source": f"{REPORT} p. 83"}},
        {"value": "Flame Spread", "evidence": {"text": "Opposed and concurrent flame spread rates over films, slabs, rods and fabric.", "source": f"{META} Approach; {REPORT} pp. 21, 56, 71"}},
        {"value": "Flame Extinction", "evidence": {"text": "Quenching and blowoff extinction limits as a function of O2 and flow.", "source": f"{REPORT} pp. 21, 97, 109"}},
        {"value": "Combustion Behavior", "evidence": {"text": "Combustion products (O2, CO, CO2), heat release rate, global equivalence ratio.", "source": f"{REPORT} pp. 9-10, 19"}},
    ],
    "fuel": {
        "types": ["Solid Materials"],
        "materials": ["PMMA (acrylic) thin films 0.1-0.4 mm", "PMMA slabs 1-5 mm", "PMMA rods 1/4, 3/8, 1/2 in (clear and black)",
                      "SIBAL cotton-fiberglass fabric", "Nomex III fabric", "wax candle"],
        "geometry": "Flat films and slabs (1- and 2-sided), cylindrical rods, fabric sheets, spherical sections",
    },
    "measurement_types": [
        {"value": "Flame Spread Rate", "evidence": {"text": "Spread rate of the leading edge, e.g. steady 2.2 mm/s over 100 um PMMA film.", "source": f"{REPORT} p. 21"}},
        {"value": "Extinction Conditions", "evidence": {"text": "Quenching flow speeds and blowoff limits vs O2.", "source": f"{REPORT} pp. 21, 83, 109"}},
        {"value": "Flame Size", "evidence": {"text": "Flame length, width and standoff distance over time.", "source": f"{REPORT} p. 72 (Fig. 6.4)"}},
        {"value": "Burning Rate", "evidence": {"text": "Rod regression and mass burning rate along the flammability boundary.", "source": f"{REPORT} p. 72"}},
    ],
    "key_findings": [
        {"finding": "Flame spread over black PMMA rods was seen down to 17.5% O2 in microgravity, while in normal gravity it was not seen below 19%.",
         "fire_safety_relevance": "Low ventilation in space can let materials burn at O2 levels where Earth tests show no spread.",
         "evidence": {"text": "Comparison of minimum O2 for flame spread", "source": f"{REPORT} p. 58"}},
        {"finding": "The PMMA rod flammability boundary has a minimum near 13.5% O2, well below the 15.4% upward-burning limit measured in normal gravity.",
         "fire_safety_relevance": "The standard Earth upward test may not be conservative for space; the low-flow 'Goldilocks' zone is typical of spacecraft ventilation near surfaces.",
         "evidence": {"text": "Flammability boundary minimum and comparison with 1g limit", "source": f"{REPORT} pp. 83-84"}},
        {"finding": "Extrapolating the blowoff limit to zero flow gives a conservative estimate of the minimum O2 for material flammability in space.",
         "fire_safety_relevance": "Proposed method to derate materials from normal-gravity tests so they will not burn in space.",
         "evidence": {"text": "Blowoff branch is linear with flow", "source": f"{REPORT} p. 83"}},
        {"finding": "Ignition delay near the limit can be almost 10 times the NASA-STD-6001 igniter on-time, and ignition limits sit at higher O2 than flammability limits.",
         "fire_safety_relevance": "A material that fails to ignite in a standard test may still sustain a flame once lit by a longer heat source.",
         "evidence": {"text": "Olson conclusions", "source": f"{REPORT} p. 97"}},
        {"finding": "Thin PMMA flames went out by radiative extinction at opposed flows of about 1 cm/s (100-300 um) and 1.5 cm/s (400 um); the critical velocity was about 10 mm/s at 21% O2 and 30 mm/s at 16%.",
         "fire_safety_relevance": "Cutting ventilation can extinguish flames on thin materials; less flow is needed to sustain them at higher O2.",
         "evidence": {"text": "Bhattacharjee results, Table 2.1", "source": f"{REPORT} pp. 21, 36"}},
        {"finding": "Concurrent-flow quenching speeds for SIBAL fabric were 1-5 cm/s, higher at lower O2 (O2 varied 21% to 16%).",
         "fire_safety_relevance": "Defines the ventilation level below which fabric fires quench on their own.",
         "evidence": {"text": "T'ien abstract", "source": f"{REPORT} p. 101"}},
        {"finding": "Nomex samples did not ignite; a wax candle ejected a burning droplet upstream.",
         "fire_safety_relevance": "Supports Nomex as an ISS fire barrier; melting plastics can spread fire by ejecting burning droplets in microgravity.",
         "evidence": {"text": "Ferkul results", "source": f"{REPORT} p. 54"}},
        {"finding": "Flames were fuel rich (global equivalence ratio about 1.3) with high CO/CO2 ratios; heat release was mostly well below 100 W.",
         "fire_safety_relevance": "Small space fires are inefficient and produce relatively more CO; a fire this size would dilute to about 1.5 ppm CO in the US Lab, below the 10 ppm long-term SMAC.",
         "evidence": {"text": "Overall conclusions and combustion products", "source": f"{REPORT} pp. 16, 19"}},
        {"finding": "Thicker PMMA spread more slowly; two-sided samples spread faster than one-sided. Near 19% O2, two-sided thick samples stopped spreading and were consumed from the trailing edge.",
         "fire_safety_relevance": "Material thickness and exposure (one or both faces) change how fast a fire grows.",
         "evidence": {"text": "Miller/Wichman results", "source": f"{REPORT} pp. 66, 71"}},
    ],
}


def build(table_path, meta_path):
    df = load_table(table_path)
    meta = load_meta(meta_path)
    v = df[df.o2_i_n.between(*O2_VALID)]
    doi = meta.get("Comment[DOI]")
    sets = condition_sets(df)
    return {
        "investigation": {
            "psi_id": meta.get("Study Identifier", PSI_ID),
            "title": meta.get("Study Title"),
            "acronym": meta.get("Comment[Investigation Acronym]"),
            "program": "BASS-II",
            "related_programs": ["BASS", "SoFIE"],
            "data_type": "flight experiment",
            "platform": meta.get("Comment[Flight Platform]"),
            "hardware": meta.get("Comment[Experiment Hardware]"),
            "dates": [meta.get("Comment[Investigation Start Date]"), meta.get("Comment[Investigation End Date]")],
            "doi": doi,
            "reference_link": f"https://doi.org/{doi}" if doi else None,
            "objective": meta.get("Comment[Objective]"),
        },
        **{k: CURATED[k] for k in ["crew_environments", "fire_safety_categories", "research_topics", "fuel"]},
        "conditions": {
            "oxygen_concentration": {"min": r(v.o2_i_n.min()), "max": r(v.o2_i_n.max()), "unit": "% by volume",
                                     "evidence": {"text": f"Calibrated initial O2 {v.o2_i_n.min()}-{v.o2_i_n.max()}% across {len(v)} tests", "source": TABLE}},
            "pressure": {"min": 101.3, "max": 101.3, "unit": "kPa",
                         "evidence": {"text": "ISS cabin pressure; analyses use P = 1 atm. Not recorded per test.", "source": f"{REPORT} pp. 19, 36"}},
            "airflow_velocity": {"min": 0, "max": 55, "unit": "cm/s",
                                 "evidence": {"text": "Fan-driven duct flow up to ~55 cm/s (no restrictors) or ~35 cm/s (two restrictors); per-test values are free text.", "source": f"{REPORT} p. 12"}},
            "gravity_level": {"values": ["microgravity"],
                              "evidence": {"text": "Flight platform: International Space Station", "source": META}},
            "diluents": ["N2"],
        },
        "measurement_types": CURATED["measurement_types"],
        "test_summary": {
            "n_tests": int(len(df)),
            "test_dates": [str(d.date()) for d in (lambda x: [x.min(), x.max()])(
                pd.to_datetime(df.date[~df.date.str.contains("2018")], format="%m/%d/%Y", errors="coerce"))],
            "by_principal_investigator": df.pi.value_counts().to_dict(),
            "by_geometry": df.geometry.value_counts().to_dict(),
            "by_material": df.material.value_counts().to_dict(),
        },
        "condition_sets": sets,
        "tests": test_rows(df, sets),
        "computed_findings": computed_findings(df),
        "key_findings": CURATED["key_findings"],
        "sources": [TABLE, META, REPORT],
        "notes": data_issues(df) + [
            "Tested at about 21% O2 or below and ~1 atm; no data at the raised-O2, reduced-pressure conditions planned for lunar habitats.",
            "Microgravity only; no partial-gravity data.",
            "Spherical section material (T3, T7) is not named in the table.",
        ],
    }


if __name__ == "__main__":
    table, meta, out = sys.argv[1:4]
    rec = build(table, meta)
    json.dump(rec, open(out, "w"), indent=2, default=str)
    print(f"wrote {out}: {rec['test_summary']['n_tests']} tests, {len(rec['condition_sets'])} condition sets")
