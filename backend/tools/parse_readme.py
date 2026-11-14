"""Parse a PSI 'ReadMe_List_of_Data' xlsx into condition-set records.

The sheet holds several small tables stacked vertically; each starts with a
header row whose first non-empty cell is 'Fuel'. Column names differ per table
(e.g. XO3 or XHe as a third composition column), so we map by header text.
Usage: python3 -I parse_readme.py <input.xlsx> <output.json> <PSI-ID>
"""
import json, re, sys
import openpyxl

NUM = r"[-+]?\d*\.?\d+"

def parse_range(v):
    """'2.0 - 7.0' | '0.5 and 5.0' | '~4.5' | 4 -> {min,max,approx,raw}"""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return {"min": float(v), "max": float(v), "approx": False, "raw": v}
    s = str(v).strip()
    nums = [float(x) for x in re.findall(NUM, s)]
    if not nums:
        return {"min": None, "max": None, "approx": False, "raw": s}
    return {"min": min(nums), "max": max(nums), "approx": "~" in s, "raw": s}

def parse_fuels(v):
    return [f.strip() for f in str(v).split(",")] if v else []

def norm(h):
    return re.sub(r"[^a-z0-9]", "", str(h).lower())

def parse(path, psi_id):
    ws = openpyxl.load_workbook(path, data_only=True).active
    records, header = [], None
    for row in ws.iter_rows(values_only=True):
        cells = [c for c in row]
        if not any(c is not None for c in cells):
            continue
        if any(norm(c) == "fuel" for c in cells if c is not None):
            header = {norm(c): i for i, c in enumerate(cells) if c is not None}
            continue
        if header is None:
            continue
        named = {"datafile", "reference"}
        get = lambda k: cells[header[k]] if k in header and header[k] < len(cells) else None
        # data-file / reference columns sit right of the table, often unnamed
        named = {"datafile", "reference"}
        start = max(i for k, i in header.items() if k not in named) + 1
        extra = [c for c in cells[start:] if c is not None]
        data_file = next((c for c in extra if not str(c).startswith("http") and not str(c).startswith("Fig")), None)
        ref = next((str(c).strip() for c in extra if str(c).startswith("http")), None)
        fig = next((c for c in extra if str(c).startswith("Fig")), None)
        comp = {}
        for k in header:
            if k.startswith("x") and k != "xo2" and k not in named:
                comp[k[1:].upper()] = get(k)
        rec = {
            "investigation_id": psi_id,
            "fuels": parse_fuels(get("fuel")),
            "droplet_diameter_mm": parse_range(get("do mm") or get("domm")),
            "pressure_atm": parse_range(get("patm")),
            "x_o2": get("xo2"),
            "other_composition": comp,
            "data_file": data_file, "reference": ref, "figure": fig,
            "flags": [],
        }
        # sanity checks -> flags for human review
        vals = [v for v in [rec["x_o2"], *comp.values()] if isinstance(v, (int, float))]
        if any(v > 1 for v in vals):
            rec["flags"].append("composition value >1: mixed units (fraction vs percent/ppm?) - check source")
        if any(isinstance(v, str) for v in comp.values()):
            rec["flags"].append("non-numeric composition entry (e.g. 'Balance')")
        if vals and all(v <= 1 for v in vals) and abs(sum(vals) - 1) > 0.02 and not rec["flags"]:
            rec["flags"].append(f"composition sums to {sum(vals):.2f}, not 1")
        records.append(rec)
    return records

if __name__ == "__main__":
    src, dst, pid = sys.argv[1:4]
    recs = parse(src, pid)
    json.dump(recs, open(dst, "w"), indent=2)
    print(f"{len(recs)} condition sets -> {dst}; {sum(bool(r['flags']) for r in recs)} flagged")
