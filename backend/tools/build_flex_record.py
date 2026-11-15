"""Build the fire-safety JSON record for PSI-69 (FLEX) from its PSI files.

Numbers come from code (experiment table + metadata). Category/topic tags come
from reading the documents and are kept in CURATED below, each with evidence
(page numbers refer to PDF pages). In the full pipeline, CURATED is what the
Gemini extraction step produces and a human checks.

Usage:
  python build_flex_record.py <experiment_table.csv> <metadata.zip> <out.json>
"""
import io
import json
import sys
import zipfile

import numpy as np
import pandas as pd

MMHG_TO_KPA = 0.133322
PSI_ID = "PSI-69"
EIRD = "FLEX_EIRD_v4.pdf (FLEX Research Requirements Document, 2005)"
TABLE = "PSI-69_Experimental_table_FLEX.csv"
META = "PSI-69_metadata (i_Investigation.txt)"

# Planned moon-base cabin, from the challenge brief: >=30% O2 at <=10.2 psi
MOON_O2, MOON_P_KPA = 0.30, 10.2 * 6.895


def load_table(path):
    df = pd.read_csv(path, encoding="latin-1")
    df.columns = ["test", "flex_id", "date", "gmt", "fuel", "p_mmhg", "x_o2", "x_n2",
                  "x_co2", "x_he", "d0_mm", "dext_mm", "burn_rate", "burn_time_s", "test_end"]
    for c in ["p_mmhg", "x_o2", "x_n2", "x_co2", "x_he", "d0_mm", "dext_mm", "burn_rate", "burn_time_s"]:
        # '~6' -> 6; unreadable characters -> NaN
        df[c] = pd.to_numeric(df[c].astype(str).str.replace("~", "", regex=False), errors="coerce")
    df.loc[df.p_mmhg <= 0, "p_mmhg"] = np.nan          # test 114 logs 0 mmHg: data error
    df.loc[df.d0_mm <= 0, "d0_mm"] = np.nan
    df.loc[df.dext_mm <= 0, "dext_mm"] = np.nan         # 0 = no measurable extinction diameter
    df["p_kpa"] = df.p_mmhg * MMHG_TO_KPA
    df["suppressant"] = np.select([df.x_co2 > 0, df.x_he > 0], ["CO2", "He"], "none")
    df["suppressant_frac"] = df[["x_co2", "x_he"]].max(axis=1)
    df["ratio"] = df.dext_mm / df.d0_mm
    return df


def load_meta(zip_path):
    with zipfile.ZipFile(zip_path) as z:
        name = next(n for n in z.namelist() if n.endswith("i_Investigation.txt"))
        text = io.TextIOWrapper(z.open(name), encoding="utf-8", errors="replace").read()
    meta = {}
    for line in text.splitlines():
        parts = line.split("\t")
        if len(parts) > 1 and parts[0].strip():
            meta[parts[0].strip()] = parts[1].strip().strip('"')
    return meta


def r(x, n=2):
    return None if pd.isna(x) else round(float(x), n)


def condition_sets(df):
    d = df.dropna(subset=["p_kpa"]).copy()
    d["p_bin"] = (d.p_kpa / 5).round() * 5          # group near-identical pressures
    out = []
    groups = d.groupby(["fuel", "p_bin", "x_o2", "suppressant", "suppressant_frac"])
    for i, ((fuel, p, o2, sup, sf), g) in enumerate(groups, start=1):
        out.append({
            "set_id": f"{PSI_ID}-CS{i:02d}",
            "tests": [{"test_number": int(t), "test_identifier": str(x)} for t, x in zip(g.test, g.flex_id)],
            "fuel": fuel, "pressure_kpa": r(p, 0), "oxygen_pct": r(o2 * 100, 1),
            "suppressant": sup, "suppressant_pct": r(sf * 100, 1),
            "n_tests": int(len(g)), "outcomes": g.test_end.value_counts().to_dict(),
            "mean_initial_diameter_mm": r(g.d0_mm.mean()),
            "mean_extinction_to_initial_ratio": r(g.ratio.mean()),
            "mean_burning_rate": r(g.burn_rate.mean(), 3),
        })
    return out


def test_rows(df, sets):
    """One row per test run, with the numbers the dashboard charts use."""
    set_of = {t["test_number"]: cs["set_id"] for cs in sets for t in cs["tests"]}
    rows = []
    for _, t in df.iterrows():
        m = []
        if pd.notna(t.burn_rate):
            m.append({"quantity": "burning_rate", "value": float(t.burn_rate), "unit": "unconfirmed",
                      "definition": "FLEX table burning-rate column (source label: mm; physical unit unconfirmed)", "source": TABLE})
        if pd.notna(t.dext_mm):
            m.append({"quantity": "extinction_condition", "value": float(t.dext_mm), "unit": "mm",
                      "definition": "Visible flame extinction diameter", "source": TABLE})
        rows.append({
            "test_number": int(t.test), "test_identifier": str(t.flex_id), "set_id": set_of.get(int(t.test)),
            "oxygen_pct": r(t.x_o2 * 100, 1), "pressure_kpa": r(t.p_kpa, 1), "airflow_cm_s": None,
            "outcome": t.test_end if isinstance(t.test_end, str) else None,
            "initial_diameter_mm": r(t.d0_mm), "measurements": m,
        })
    return rows


def computed_findings(df):
    f = []
    air = df[(df.suppressant == "none") & df.p_kpa.between(95, 108) & (df.test_end == "Extinction")]
    trend = air.groupby(["fuel", "x_o2"]).ratio.mean().round(2).dropna()
    f.append({
        "finding": "Without suppressant at about 1 atm, flames generally went out at a larger fraction of the initial droplet size as oxygen dropped (not strictly monotonic for methanol).",
        "data": {f"{fu} {o2*100:.0f}% O2": v for (fu, o2), v in trend.items()},
        "method": "Mean (extinction diameter / initial diameter) per fuel and O2 level, tests ending in 'Extinction', 95-108 kPa, no CO2/He.",
        "source": TABLE,
    })
    hi = df[df.x_o2 >= MOON_O2]
    moon = hi[hi.p_kpa <= MOON_P_KPA + 2]  # 2 kPa tolerance for chamber setpoint scatter
    f.append({
        "finding": f"{len(hi)} tests ran at 30-34% O2; only {int((hi.test_end == 'Extinction').sum())} ended in extinction. "
                   f"{len(moon)} of them were at about 70-72 kPa, close to the planned Moon-base cabin pressure.",
        "data": {"all_high_o2_outcomes": hi.test_end.value_counts().to_dict(),
                 "near_moon_base_pressure_outcomes": moon.test_end.value_counts().to_dict()},
        "method": "Filter x_o2 >= 0.30; Moon-base reference (>=30% O2, <=70.3 kPa) is from the Space Apps brief, not from FLEX documents.",
        "source": TABLE,
    })
    f.append({
        "finding": "Diluent suppressants were tested up to 70% CO2 and 45% He; SF6 was planned but has no tests in this table.",
        "data": {"tests_by_suppressant": df.suppressant.value_counts().to_dict(),
                 "max_co2_pct": r(df.x_co2.max() * 100, 0), "max_he_pct": r(df.x_he.max() * 100, 0)},
        "method": "Counts from x_co2 / x_he columns.",
        "source": f"{TABLE}; {EIRD} p. 38",
    })
    sup = df[df.suppressant != "none"]
    f.append({
        "finding": f"No CO2 or He suppressant tests were run above {sup.x_o2.max()*100:.0f}% O2, so suppressant data does not reach the 30%+ O2 range planned for lunar habitats.",
        "data": {"max_o2_pct_with_CO2": r(df[df.suppressant == "CO2"].x_o2.max() * 100, 0),
                 "max_o2_pct_with_He": r(df[df.suppressant == "He"].x_o2.max() * 100, 0)},
        "method": "Max x_o2 among tests with x_co2 > 0 or x_he > 0.",
        "source": TABLE,
    })
    return f


CURATED = {
    "crew_environments": [
        {"value": "Space Station", "basis": "stated",
         "justification": "Flown on the ISS; documents discuss CO2 extinguishers used in US ISS modules."},
        {"value": "Spacecraft", "basis": "stated",
         "justification": "Research area is spacecraft fire safety; Shuttle extinguishers are discussed as current practice."},
        {"value": "Lunar Base", "basis": "inferred",
         "justification": "Tests at 30-34% O2 and about 71 kPa sit at the planned Moon-base cabin conditions from the challenge brief. Documents do not name a lunar base."},
        {"value": "Pressurized Rover", "basis": "inferred",
         "justification": "Same reduced-pressure, raised-O2 conditions as the Moon base. Documents also mention high-O2 EVA pre-breathe atmospheres."},
    ],
    "fire_safety_categories": [
        {"value": "Fire Suppression",
         "evidence": {"text": "Quantify the efficacy of gaseous suppressants (CO2, He, SF6) over candidate pressures and O2 levels.", "source": f"{EIRD} p. 28"}},
        {"value": "Fire Prevention",
         "evidence": {"text": "Map flammability boundaries and the limiting oxygen index (LOI) of liquid fuels in reduced gravity.", "source": f"{EIRD} p. 28; {META} Approach"}},
    ],
    "research_topics": [
        {"value": "Flame Extinction", "evidence": {"text": "Extinction droplet diameter as a function of pressure, oxygen and suppressant.", "source": f"{EIRD} p. 31"}},
        {"value": "Material Flammability", "evidence": {"text": "Flammability boundaries and LOI as a function of pressure for the test fuels.", "source": f"{EIRD} p. 31"}},
        {"value": "Combustion Behavior", "evidence": {"text": "Burning rate, flame radiation, soot volume fraction and temperature.", "source": f"{EIRD} p. 28"}},
        {"value": "Smoke & Aerosols", "evidence": {"text": "Soot measured; soot escaping the flame is described as a long-term crew health hazard.", "source": f"{EIRD} p. 31"}},
    ],
    "fuel": {
        "types": ["Liquid Fuels"],
        "materials": ["methanol (non-sooting alcohol)", "n-heptane (sooting alkane)"],
        "geometry": "Single droplets, fiber-supported or free, tested initial diameter 1.1-4.7 mm",
    },
    "measurement_types": [
        {"value": "Burning Rate", "evidence": {"text": "Burning rate column; droplet size history from backlit view.", "source": f"{TABLE}; {EIRD} p. 30"}},
        {"value": "Extinction Conditions", "evidence": {"text": "Visible flame extinction diameter and test outcome per test.", "source": TABLE}},
        {"value": "Flame Size", "evidence": {"text": "OH* imaging to capture flame size and thickness at extinction.", "source": f"{EIRD} p. 30"}},
    ],
    "key_findings": [
        {"finding": "CO2, the current US ISS suppressant, is not physiologically inert at the concentrations needed to put out fires in microgravity, and its effectiveness there needed testing.",
         "fire_safety_relevance": "Motivates evaluating alternative inert diluents (He) and the CO2 levels actually needed.",
         "evidence": {"text": "Summary of fire-suppression background", "source": f"{EIRD} p. 13"}},
        {"finding": "At high oxygen levels droplets tend to burn to completion instead of extinguishing, so extinction behavior must be mapped at low O2 down to the LOI.",
         "fire_safety_relevance": "High-O2 cabins (EVA pre-breathe, planned lunar habitats) leave less margin before a fire self-extinguishes.",
         "evidence": {"text": "Independent variables: oxygen mole fraction", "source": f"{EIRD} p. 29"}},
        {"finding": "Low-pressure suppressant data were wanted because isolating a module and venting it to space is one firefighting strategy.",
         "fire_safety_relevance": "Links depressurization response to measured extinction behavior at reduced pressure.",
         "evidence": {"text": "Independent variables: pressure", "source": f"{EIRD} p. 29"}},
    ],
}


def build(table_path, zip_path):
    df = load_table(table_path)
    meta = load_meta(zip_path)
    o2_ev = {"text": f"x_O2 from {df.x_o2.min()} to {df.x_o2.max()} across {len(df)} tests", "source": TABLE}
    p = df.p_kpa.dropna()
    sets = condition_sets(df)
    return {
        "investigation": {
            "psi_id": meta.get("Study Identifier", "PSI-69"),
            "title": meta.get("Study Title", "Flame Extinguishment Experiment"),
            "acronym": meta.get("Comment[Investigation Acronym]", "FLEX"),
            "program": "FLEX",
            "related_programs": ["FLEX-2", "DCE"],
            "data_type": "flight experiment",
            "platform": meta.get("Comment[Flight Platform]"),
            "hardware": meta.get("Comment[Experiment Hardware]"),
            "dates": [meta.get("Comment[Investigation Start Date]"), meta.get("Comment[Investigation End Date]")],
            "doi": meta.get("Comment[DOI]"),
            "reference_link": f"https://doi.org/{meta.get('Comment[DOI]')}" if meta.get("Comment[DOI]") else None,
            "objective": meta.get("Comment[Objective]"),
        },
        **{k: CURATED[k] for k in ["crew_environments", "fire_safety_categories", "research_topics", "fuel"]},
        "conditions": {
            "oxygen_concentration": {"min": r(df.x_o2.min() * 100, 1), "max": r(df.x_o2.max() * 100, 1),
                                     "unit": "% by volume", "evidence": o2_ev,
                                     "planned": {"min": 10, "max": 40, "evidence": {"text": "oxygen mole fraction shall range from 0.1-0.4", "source": f"{EIRD} p. 38"}}},
            "pressure": {"min": r(p.min(), 1), "max": r(p.max(), 1), "unit": "kPa",
                         "evidence": {"text": f"{df.p_mmhg[df.p_mmhg > 0].min()}-{df.p_mmhg.max()} mmHg in the table", "source": TABLE},
                         "planned": {"min": 50.7, "max": 304.0, "evidence": {"text": "initial pressure 0.5-3.0 atm", "source": f"{EIRD} p. 37"}}},
            "airflow_velocity": {"min": 0.1, "max": 5.0, "unit": "cm/s",
                                 "evidence": {"text": "Target flow 0.1-5 cm/s for a subset of tests (droplet translated); most tests quiescent. Not recorded per test in the table.", "source": f"{EIRD} p. 38"}},
            "gravity_level": {"values": ["microgravity"],
                              "evidence": {"text": "Flight platform: International Space Station", "source": META}},
            "diluents": ["N2", "CO2", "He"],
        },
        "measurement_types": CURATED["measurement_types"],
        "test_summary": {
            "n_tests": int(len(df)), "test_dates": [df.date.iloc[0], df.date.iloc[-1]],
            "by_fuel": df.fuel.value_counts().to_dict(),
            "by_outcome": df.test_end.value_counts().to_dict(),
            "by_suppressant": df.suppressant.value_counts().to_dict(),
            "initial_diameter_mm": [r(df.d0_mm.min()), r(df.d0_mm.max())],
            "extinction_diameter_mm": [r(df.dext_mm.min()), r(df.dext_mm.max())],
            "burn_time_s": [r(df.burn_time_s.min()), r(df.burn_time_s.max())],
        },
        "condition_sets": sets,
        "tests": test_rows(df, sets),
        "computed_findings": computed_findings(df),
        "key_findings": CURATED["key_findings"],
        "sources": [TABLE, META, EIRD,
                    "FLEX_Overall_Ext_File-2.pdf (hardware handbook excerpts: CIR diagnostics, MDCA/FLEX-2 safety data)",
                    "FLEX_Engineering_Requirements_Document.pdf (FLEX-2 ERD, 2010)"],
        "notes": [
            "The Engineering Requirements Document is for FLEX-2, a separate follow-on investigation. It was not used for FLEX values.",
            "FLEX_Overall_Ext_File-2.pdf is mostly rack hardware and imaging specs; used only to confirm diagnostics.",
            "Burning-rate column is labelled 'mm' in the table. Its physical unit is unconfirmed.",
            "Test 114 (C11M201) records 0 mmHg pressure; treated as missing. Some cells contain unreadable characters; treated as missing.",
            "Extinction diameter of 0 treated as 'no measurable extinction diameter', not as a measurement.",
            "Tested pressure starts at ~70 kPa although 0.5 atm was planned; SF6 was planned but not tested in this table.",
            "Lunar Base and Pressurized Rover tags are inferred from conditions, not stated in FLEX documents.",
        ],
    }


if __name__ == "__main__":
    table, zp, out = sys.argv[1:4]
    rec = build(table, zp)
    json.dump(rec, open(out, "w"), indent=2, default=str)
    print(f"wrote {out}: {rec['test_summary']['n_tests']} tests, {len(rec['condition_sets'])} condition sets")
