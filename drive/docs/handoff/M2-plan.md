# M2 plan: first real course (Caswell Pines)

## Context
M1 is merged (PR #3, plus handoff PR #4). M2 replaces the synthetic `dummy-01` with a real course built from public GIS data: Caswell Pines Golf Club, 2380 County Home Rd, Blanch, NC 27212, at 36.43859, -79.31938 (UTM 17N). Hole 1 comes first, then all 18, plus a 10 m horizon skirt out to about 3 km. The packet is committed, and every M0/M1 test runs against it.

**Decisions so far**
- Rights: the name and the logo are both allowed. The packet is `id: "caswell-pines"`, `name: "Caswell Pines Golf Club"`. The PRD non-goal line changes to match.
- Tests: the pipeline authors real qa poses. Tests that only make sense on the synthetic pad stay pinned to `dummy-01`.
- GIS downloads run in the cloud once the hosts are allowed.
- The reference zips are unzipped to `data/reference/reference_front9|back9/`. Git ignores them (checked with `git check-ignore`), and they are never committed.

**Network probe (done read-only before planning)**
| Host | Status | What it serves |
| --- | --- | --- |
| `tnmaccess.nationalmap.gov` | reachable | TNM product API |
| `prd-tnm.s3.amazonaws.com` | reachable | DEM downloads |
| `overpass-api.de` | **blocked** (connection reset) | OSM course polygons and paths |
| `rockyweb.usgs.gov` | blocked | 2003 LAZ point clouds (probably not needed) |
| `sdd.nc.gov` | reachable | NC Spatial Data Download (newer NC lidar, to confirm) |

**What elevation data covers the course.** TNM has **no 3DEP 1 m DEM** for this area. It offers:
- a 1/9 arc-second (~3 m) DEM, `ned19_n36x50_w079x50_nc_statewide_2003`, a 205 MB zip derived from 2003 lidar;
- the 1/3 arc-second (~10 m) tile `USGS_13_n37w080`;
- 2003 LAZ point clouds only.

## 1. Files in build order
0. Branch `m2-caswell-pines` from `origin/main`.
1. **Data-source probe (step 0, no code committed):** check sdd.nc.gov for NC's 2015 QL2 DEM over Caswell County. Record its CRS (likely EPSG:6543 or 2264, US survey feet), vertical datum, licence and download host. I'll report back before writing `dem.py` if it needs another host. Fallback: the 2003 1/9 arc-second DEM.
2. `pipeline/pyproject.toml` and `uv.lock`: pin rasterio, pyproj, shapely, geopandas, scipy, scikit-image and pillow.
3. `.gitignore`: add `data/gis/` (the raw download cache).
4. `pipeline/courses/caswell-pines/course.toml`: location, UTM bbox, stage extents (`hole1`, `full`), the horizon radius, and every tunable number. Per CLAUDE.md, nothing goes inline.
5. `pipeline/src/gcs_pipeline/fetch.py`: TNM, NC and Overpass downloads with a cache and a sha256 manifest. Runs are offline-replayable from the cache.
6. `dem.py`: reproject to UTM 17N, convert US survey feet, fill no-data and pits, apply a 3×3 median, resample to a 1 m grid.
7. `osm.py`: an Overpass query plus a parser for `golf=*`, cart paths, water, buildings, woods and bridges.
8. `polygons.py`: buffer out and in (r≈3 m), simplify, resolve overlaps by priority, add the 1.5 m green fringe, then merge `pipeline/courses/caswell-pines/overrides.geojson`. The overrides win.
9. `sculpt.py`: smooth per surface with feathered masks, plane-fit tees and greens, add green undulation, bowl the bunkers, flatten water with a shelf, and relax slopes over 35% into embankment.
10. `paths.py`: OSM paths or A* from each green to the next tee, then RDP, Catmull-Rom, 1D Gaussian, the grade and cross-slope cap, the corridor carve, and bridges.
11. `scatter.py`: trees from OSM woods polygons with integer-hash placement (no RNG streams).
12. `horizon.py`: the 1/3 arc-second DEM to a 10 m grid out to about 3 km, stitched to the course edge heights.
13. `qa.py`: author `driveStart` (the longest straight run under 2% on fairway or path, at least 170 m), one probe per material, `waterEntry` at a real pond with a cut wading shelf, and a deep-water pose.
14. `packet.py` and `schema.py` (extended), `report.py` (hillshade before and after, slope and grade stats, a provenance list, into `pipeline/reports/<id>/`), and `cli.py`: `gce-course --course caswell-pines --stage hole1|full`.
15. `packages/level-schema/schema/course.schema.json` plus its TS types: an optional `horizon {file, cellSize, width, height, originX, originZ, scale, offset}`, an optional `logo`, and an optional `qa.deepWater`.
16. `apps/web/src/level/loadLevel.ts`: load the horizon. New `apps/web/src/terrain/horizon.ts` renders it as a skirt mesh (visual only). The course edge gets a low boundary collider so the cart can reach the edge but not fall off.
17. `apps/web/src/terrain/chunks.ts`: distance LOD (node stride 1/2/4 with skirts against cracks), to stay under 2 M triangles and 300 draw calls on High.
18. Tests: move the `dummy-01`-only cases (`forward.test.ts`'s (0, −175) slope and the `wheelPad` cases) behind `describe.runIf(LEVEL_ID==='dummy-01')`. Deep water reads the new `qa.deepWater`.
19. Run `hole1` and commit `apps/web/public/levels/caswell-pines/`. Then run `full` and replace it, keeping IDs stable: holes 1–18 in `holes.json`, with material and water IDs from the config.
20. `ATTRIBUTION.md` (OSM ODbL, USGS public domain, NC lidar terms, club logo with permission), `course.json.attribution`, the logo at `apps/web/public/levels/caswell-pines/logo.webp`, the PRD non-goal edit, and `docs/screens/m2/`.

## 2. Tests mapped to the acceptance checkboxes
**Checkbox 1: packet validates; sculpt report reviewed**
- pytest: a synthetic fixture per step (dem reprojection and feet conversion, polygon cleanup, the sculpt rules, path smoothing, horizon stitch, qa authoring)
- `test_packet.py` and `test_determinism.py` against the real packet
- level-schema validation, plus file hashes matching
- report stats JSON present
- **You review** the hillshades and stats in the gate PR

**Checkbox 2: slope limits**
- `test_layout.py` limits, parametrized over `caswell-pines`: greens ≤3%, paths ≤12% grade and ≤2% cross-slope, drivable ≤35%
- an extra per-hole green check

**Checkbox 3: M0/M1 tests pass; cart drives the whole course and the horizon edge**
- `GCS_LEVEL=caswell-pines pnpm -r test` with zero skips apart from the dummy-pinned cases
- new `courseTour.test.ts`: headless Chill drive along every cart path from tee 1 to green 18 (no NaN, no stuck, no fall-through)
- new `edge.test.ts`: drive into all four edges; the cart stops on the boundary and its height stays sane
- triangle and draw-call budget test on the LOD chunks
- Playwright smoke on WebGL2 with screenshots

## 3. Ambiguities, contradictions and risks (starting from the handoff traps)
1. **Network.** Overpass is still blocked. Without it there are no OSM layers and everything is hand-drawn. I won't fabricate terrain. Each step is unit-tested on fixtures first.
2. **Which lidar.** No 1 m 3DEP exists here. The 2003 data is about 3 m and 23 years old, and parts of the course or nearby houses may have changed since. NC's QL2 data needs checking. Either way, greens, tees, bunkers and paths are authored, so a 3 m source is enough for the landforms.
3. **OSM coverage is unknown.** If there are no `golf=*` polygons, M2 becomes mostly authoring in `overrides.geojson`. That needs an aerial base. I propose USGS NAIP (public domain) over the TNM API, never the flyover stills.
4. **Optional-pad skips.** Settled: the pipeline authors the qa poses. A real 170 m flat straight may not exist. If it doesn't, I'll ask before lowering the `joyrideTopSpeed` window.
5. **Grid and performance.** The course is about 1.5×1.2 km, or 3.6 M triangles without LOD. The LOD in step 17 is new M2 work that the PRD doesn't list.
6. **Hole 1 as a partial packet.** The extent is hole 1 plus 60 m and the path to the clubhouse. The same `course.toml` origin is used for the full run, so coordinates and IDs don't move.
7. **"Drives the horizon edge" is undefined.** I read it as: drive to the course boundary, see the skirt continue without a seam, and be stopped gently. The skirt has no collider.
8. **Height scale.** Relief within 3 km may exceed the 65.5 m that `scale=0.001` allows. The course raises its scale if needed, and the horizon gets its own scale and offset.
9. **Determinism.** Gaussian smoothing and reprojection aren't integer-exact. The definition: same machine plus the same cached inputs give the same bytes, and the committed packet is the reference. Fixture tests stay byte-exact.
10. **Name and logo vs PRD.** You've allowed both. I'll edit the non-goal line and record the permission in ATTRIBUTION.md. Please confirm the permission is in writing from the club.
11. **Hole 11's red tee (188 yd)** and the dogleg directions are still unverified. They are checked against the lidar and OSM layout, not the stills.
12. **Sun latitude from the packet** is listed under v2.6 but scheduled for M3. It's out of M2 scope.

## 4. What the cloud can't verify
- WebGPU rendering, real-GPU fps and the High-tier budgets on hardware. Headless Chromium is WebGL2 only and has no GPU, so I'll report triangle and draw-call counts, not fps.
- The look and feel of the 15-minute drive (your M1-style review).
- Overpass data until `overpass-api.de` is allowed.
- Whether the club's logo permission covers distribution.

## Verification
- `(cd pipeline && uv run pytest -q && uv run ruff check .)`
- `pnpm -r typecheck && pnpm -r lint && pnpm -r test`
- `GCS_LEVEL=caswell-pines pnpm --filter web test`
- `pnpm --filter web smoke`
- Paste every summary line in the gate PR, with screenshots in `docs/screens/m2/`. Then STOP until `APPROVED M2`.
