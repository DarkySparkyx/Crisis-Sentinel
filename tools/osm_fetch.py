#!/usr/bin/env python3
"""
Pobiera geometrię z OpenStreetMap (Overpass API) i zapisuje GeoJSON w formacie,
który rozumie packages/core/src/geojson.ts (properties.kind = wall|walkable|haven).

To zadanie jest w oryginalnym planie opisane jako "wejdź na Overpass Turbo" —
w praktyce to 2-3 godziny nauki Overpass QL. Tutaj zapytanie jest gotowe.

    python3 tools/osm_fetch.py --lat 52.2297 --lon 21.0122 --radius 400 \
        --out data/maps/venue.geojson

Uwaga: OSM prawie nigdy nie ma wnętrz budynków. Dla korytarza na hakatonie
użyj tools/make_venue.ts (obrys mierzony krokami/dalmierzem) — jest szybsze
i dokładniejsze niż cokolwiek, co znajdziesz w OSM.
"""
from __future__ import annotations

import argparse
import json
import math
import urllib.parse
import urllib.request

OVERPASS = "https://overpass-api.de/api/interpreter"

QUERY = """
[out:json][timeout:60];
(
  way["building"](around:{r},{lat},{lon});
  way["barrier"~"wall|fence"](around:{r},{lat},{lon});
  way["highway"~"footway|path|pedestrian|steps|corridor|service|residential"](around:{r},{lat},{lon});
  node["emergency"="assembly_point"](around:{r},{lat},{lon});
  node["amenity"="shelter"](around:{r},{lat},{lon});
);
out geom;
"""


def kind_of(tags: dict) -> str:
    if "building" in tags or tags.get("barrier") in {"wall", "fence"}:
        return "wall"
    if tags.get("highway"):
        return "walkable"
    if tags.get("emergency") == "assembly_point" or tags.get("amenity") == "shelter":
        return "haven"
    return "other"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lat", type=float, required=True)
    ap.add_argument("--lon", type=float, required=True)
    ap.add_argument("--radius", type=int, default=400, help="promień w metrach (rozsądnie: 200-800)")
    ap.add_argument("--out", default="data/maps/venue.geojson")
    a = ap.parse_args()

    q = QUERY.format(r=a.radius, lat=a.lat, lon=a.lon)
    req = urllib.request.Request(
        OVERPASS,
        data=urllib.parse.urlencode({"data": q}).encode(),
        headers={"User-Agent": "ariadna-hackathon/0.1"},
    )
    with urllib.request.urlopen(req, timeout=90) as r:
        doc = json.load(r)

    feats = []
    for el in doc.get("elements", []):
        tags = el.get("tags", {}) or {}
        kind = kind_of(tags)
        if kind == "other":
            continue
        if el["type"] == "node":
            geom = {"type": "Point", "coordinates": [el["lon"], el["lat"]]}
        elif el["type"] == "way" and el.get("geometry"):
            coords = [[p["lon"], p["lat"]] for p in el["geometry"]]
            closed = len(coords) > 3 and coords[0] == coords[-1]
            geom = {"type": "Polygon", "coordinates": [coords]} if closed else {"type": "LineString", "coordinates": coords}
        else:
            continue
        feats.append({
            "type": "Feature",
            "properties": {"kind": kind, "osm_id": el["id"], "name": tags.get("name"), **{k: v for k, v in tags.items() if k in ("building", "highway", "barrier", "level")}},
            "geometry": geom,
        })

    fc = {
        "type": "FeatureCollection",
        "properties": {"origin": {"lat": a.lat, "lon": a.lon}, "source": "overpass", "radius_m": a.radius},
        "features": feats,
    }
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False)

    counts: dict[str, int] = {}
    for x in feats:
        counts[x["properties"]["kind"]] = counts.get(x["properties"]["kind"], 0) + 1
    size_km = 2 * a.radius / 1000
    print(f"OK  {len(feats)} obiektów {counts} -> {a.out}  (obszar ~{size_km:.1f}x{size_km:.1f} km)")
    if not counts.get("haven"):
        print("UWAGA: brak punktów 'haven' w OSM. Dodaj 2-3 ręcznie "
              '(Point z properties {"kind":"haven","id":"H1","name":"..."}).')


if __name__ == "__main__":
    main()
