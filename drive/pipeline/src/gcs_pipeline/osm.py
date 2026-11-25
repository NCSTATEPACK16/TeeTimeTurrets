"""OpenStreetMap layers for a course: the Overpass query and a parser for its `out geom` JSON.

The pipeline never queries Overpass while building a packet. `gce-fetch-osm` saves one snapshot
under `courses/<id>/osm/`, which is committed (ODbL, see ATTRIBUTION.md), and everything
downstream reads that file.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

# golf=* values the course pipeline uses; anything else is kept as "golf:<value>".
GOLF_SURFACES = {
    "fairway",
    "green",
    "tee",
    "bunker",
    "rough",
    "water_hazard",
    "lateral_water_hazard",
    "cartpath",
    "path",
    "clubhouse",
    "hole",
    "pin",
    "driving_range",
}
PATH_HIGHWAYS = {"path", "footway", "track", "service", "cycleway"}


def build_query(lat: float, lon: float, radius_m: float, timeout_s: int) -> str:
    """Overpass QL for every layer the course pipeline can use within radius_m of the pin."""
    around = f"(around:{radius_m:g},{lat:.8f},{lon:.8f})"
    selectors = [
        'nwr["golf"]',
        'nwr["leisure"="golf_course"]',
        'nwr["natural"="water"]',
        'nwr["water"]',
        'nwr["landuse"~"^(reservoir|basin|forest|grass|meadow)$"]',
        'way["waterway"]',
        'nwr["natural"~"^(wood|scrub|wetland)$"]',
        'way["highway"]',
        'way["bridge"]',
        'nwr["building"]',
        'nwr["man_made"~"^(tower|mast)$"]',
    ]
    body = "\n".join(f"  {s}{around};" for s in selectors)
    return f"[out:json][timeout:{timeout_s}];\n(\n{body}\n);\nout geom;\n"


@dataclass
class Feature:
    kind: str
    osm_type: str  # node, way or relation
    osm_id: int
    tags: dict[str, str]
    # Node: one point. Way: its vertices. Relation: empty; see members.
    coords: list[tuple[float, float]] = field(default_factory=list)  # (lon, lat)
    # Relation members with geometry: (role, coords).
    members: list[tuple[str, list[tuple[float, float]]]] = field(default_factory=list)

    @property
    def closed(self) -> bool:
        return len(self.coords) > 3 and self.coords[0] == self.coords[-1]


def classify(tags: dict[str, str]) -> str:
    """One kind per element, in priority order: golf tags win over generic land cover."""
    golf = tags.get("golf")
    if golf:
        return golf if golf in GOLF_SURFACES else f"golf:{golf}"
    highway = tags.get("highway")
    if highway and (tags.get("golf_cart") in {"designated", "yes"} or tags.get("golf") == "cartpath"):
        return "cartpath"
    if tags.get("leisure") == "golf_course":
        return "course_boundary"
    if tags.get("natural") == "water" or "water" in tags or tags.get("landuse") in {"reservoir", "basin"}:
        return "water"
    if "waterway" in tags:
        return "waterway"
    if tags.get("natural") in {"wood", "scrub"} or tags.get("landuse") == "forest":
        return "woods"
    if tags.get("natural") == "wetland":
        return "wetland"
    if tags.get("landuse") in {"grass", "meadow"}:
        return "grass"
    if "building" in tags:
        return "building"
    if tags.get("man_made") in {"tower", "mast"}:
        return "tower"
    if highway:
        if tags.get("bridge") not in (None, "no"):
            return "bridge"
        return "path" if highway in PATH_HIGHWAYS else "road"
    if tags.get("bridge") not in (None, "no"):
        return "bridge"
    return "other"


def _points(geometry: list[dict]) -> list[tuple[float, float]]:
    return [(float(p["lon"]), float(p["lat"])) for p in geometry if p is not None]


def parse(data: dict) -> list[Feature]:
    """Features from an Overpass `out geom` response, sorted by (type, id) for stable output."""
    features: list[Feature] = []
    for el in data.get("elements", []):
        tags = el.get("tags") or {}
        if not tags:
            continue  # untagged nodes are way vertices
        f = Feature(kind=classify(tags), osm_type=el["type"], osm_id=int(el["id"]), tags=dict(tags))
        if el["type"] == "node":
            f.coords = [(float(el["lon"]), float(el["lat"]))]
        elif el["type"] == "way":
            f.coords = _points(el.get("geometry") or [])
        elif el["type"] == "relation":
            f.members = [
                (m.get("role", ""), _points(m.get("geometry") or []))
                for m in el.get("members", [])
                if m.get("type") == "way"
            ]
        features.append(f)
    order = {"node": 0, "way": 1, "relation": 2}
    features.sort(key=lambda f: (order.get(f.osm_type, 3), f.osm_id))
    return features


def coverage(features: list[Feature]) -> dict:
    """What the snapshot covers: feature counts by kind, and the hole numbers mapped as golf=hole."""
    counts = Counter(f.kind for f in features)
    holes = sorted(
        {int(f.tags["ref"]) for f in features if f.kind == "hole" and f.tags.get("ref", "").isdigit()}
    )
    names = sorted({f.tags["name"] for f in features if f.kind == "course_boundary" and "name" in f.tags})
    return {"counts": dict(sorted(counts.items())), "holes": holes, "courseNames": names}
