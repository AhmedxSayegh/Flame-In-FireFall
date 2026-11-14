"""Fetch PSI investigation metadata and keep the Combustion Science slice.

Uses the JSON endpoint the PSI website itself calls:
  https://psi.nasa.gov/geode-py/ws/repo/search?source=psi&type=investigation
It returns Elasticsearch-style results: {"hits": {"total": N, "hits": [{"_source": {...}}]}}
(133 investigations at the time of writing, 25 per page by default).

Run on your own machine (needs internet):  python fetch_psi_combustion.py
Outputs: psi_all_investigations.json, psi_combustion.json, psi_combustion.csv
"""
import csv
import json
import time

import requests

BASE = "https://psi.nasa.gov/geode-py/ws/repo/search"
PARAMS = {"source": "psi", "type": "investigation",
          "sort": "Public Release Date", "order": "desc"}
HEADERS = {"User-Agent": "space-apps-flame-in-freefall/0.1"}


def get(extra):
    r = requests.get(BASE, params={**PARAMS, **extra}, headers=HEADERS, timeout=60)
    r.raise_for_status()
    return r.json()["hits"]


def fetch_all():
    first = get({})
    total, hits = first["total"], first["hits"]
    if isinstance(total, dict):          # newer Elasticsearch format
        total = total.get("value", 0)
    print(f"total investigations reported: {total}; first page: {len(hits)}")
    if len(hits) >= total:
        return hits

    # The page-size/paging parameter name isn't documented; try the common ones
    # and keep whichever actually returns new records.
    for extra in ({"size": 500}, {"limit": 500}, {"rows": 500}):
        h = get(extra)["hits"]
        if len(h) > len(hits):
            print(f"page-size parameter works: {extra} -> {len(h)}")
            hits = h
            if len(hits) >= total:
                return hits

    seen = {x["_source"].get("Accession") for x in hits}
    for name, step in (("from", len(first["hits"])), ("page", 1)):
        start = step if name == "from" else 2
        new_found = False
        for i in range(start, start + 50 * step, step):
            page = get({name: i})["hits"]
            fresh = [x for x in page if x["_source"].get("Accession") not in seen]
            if not fresh:
                break
            new_found = True
            hits += fresh
            seen |= {x["_source"].get("Accession") for x in fresh}
            time.sleep(0.5)                   # be polite to NASA's server
            if len(hits) >= total:
                break
        if new_found:
            print(f"paging parameter works: {name}")
            break

    if len(hits) < total:
        print(f"WARNING: got {len(hits)} of {total}. Paging parameter not found; "
              "open DevTools > Network on the PSI search page, click 'next page', "
              "and copy the parameter it adds to the search URL.")
    return hits


def main():
    hits = fetch_all()
    records = [h["_source"] for h in hits]
    json.dump(records, open("psi_all_investigations.json", "w"), indent=2)

    comb = [r for r in records if "combustion" in str(r.get("Research Area", "")).lower()]
    json.dump(comb, open("psi_combustion.json", "w"), indent=2)

    cols = ["Accession", "Title", "Acronym", "Research Area", "SubResearch Area",
            "Project Type", "Flight Platform", "Keywords", "Related Investigations",
            "Investigation Start Date", "Investigation End Date", "Public Release Date"]
    with open("psi_combustion.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in comb:
            row = {k: r.get(k, "") for k in cols}
            row["Keywords"] = " | ".join(str(row["Keywords"]).split())  # tidy whitespace
            w.writerow(row)

    print(f"saved {len(records)} investigations; {len(comb)} in Combustion Science")
    print("fields available:", sorted({k for r in comb for k in r}))


if __name__ == "__main__":
    main()
