# pipeline

Python 3.12 (uv) tools that build level packets for `apps/web/public/levels/<id>/`.
The packet format is defined by the JSON Schemas in `packages/level-schema/schema/`.

M0 ships one command:

```sh
uv sync
uv run gce-dummy --out ../apps/web/public/levels/dummy-01   # synthetic course, byte-deterministic
uv run pytest -q
uv run ruff check .
```

## Real course (M2): Tee Time Links

```sh
uv run gce-fetch-dem --course tee-time-links     # NC 2024 QL1 lidar: 4.9 GB download, crop to data/gis/ (gitignored)
uv run gce-route --course tee-time-links         # authoring/routing.toml -> authoring/holes.json (holes 2-18 draft)
uv run gce-author --course tee-time-links        # authoring/*.json -> overrides.geojson (WGS84, edit in QGIS)
uv run gce-course --course tee-time-links --stage full --out ../apps/web/public/levels/tee-time-links
```

Every tunable lives in `courses/tee-time-links/course.toml` and `authoring/routing.toml`. The sculpt
report (hillshades, slope stats) goes to `reports/tee-time-links/` (gitignored). Real-data steps
(Gaussian smoothing, reprojection) are deterministic per machine: same machine and cached inputs
give the same bytes, and the committed packet is the reference (`test_rebuild_matches_committed_packet`).

Determinism rule (synthetic generators): generators use only correctly rounded float operations (+ - * / sqrt),
integer hashing, and fixed iteration order. No numpy RNG streams, no sin/exp/scipy filters,
no timestamps. That keeps output byte-identical across machines (x86 and Apple Silicon).
