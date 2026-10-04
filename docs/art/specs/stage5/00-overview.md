# Stage 5a: environment art (Blender)

Settled 28 Sep 2026. It runs **ahead of Stage 4**, art first, the same way Stage 7a did.

This stage authors everything in Stage 5 that Blender can build. It wires in only the pieces that depend on nothing unbuilt. Everything else is exported and smoke-checked, then handed to the issue that places it.

The shared rules are in `docs/art/specs/00-pipeline.md`. They cover the `prism` kind, the conventions, the review loop, and the testing policy of one smoke check of 15 s or less per slice with human play-tests.

## Scope

| Spec | Assets | Wired in now? |
|---|---|---|
| `trees.md` | 6 tree species, 2 per biome | **Yes.** They replace the procedural forms in `Trees.ts` and `treeline.ts` |
| `clubhouse-dressing.md` | bench, flagpole, planter, bag rack, welcome sign | **Yes.** They are placed around the clubhouse through `clubhouseLayout.ts` |
| `horizon-hills.md` | 3 distant hill cards | **Yes.** They form a ring in a new `render/horizon.ts` |
| `course-kit.md` | zone stake, tee riser, path kerb, bollard, reed clump, 3 rocks | **No, export only.** Placement belongs to #52 (stakes), #58 (tee risers), #59 (kerbs, bollards) and #55 (reeds, rocks) |
| `rider-fix.md` | re-export `driver.json` with the fixed exporter | **Yes.** It gets its own slice and a stop for approval |

## Files

- **New build script:** `art/stage5_kit.py` builds `art/environment.blend`. Like `stage7_kit.py`, the script is the source and the `.blend` is output. It exports:
  - `src/entities/graphs/trees.json` (a set)
  - `src/entities/graphs/course_kit.json` (a set)
  - `src/entities/graphs/dressing.json` (a set)
  - `src/entities/graphs/horizon.json` (a set)
- **Shared helpers:** `B()`, `R()`, `Graph`, `hexrgb()` and `triangles()` move from `stage7_kit.py` into **`art/kit_common.py`**. Both kit scripts `exec` it. After the move, `stage7_kit.py` must still reproduce `clubhouse.json`, `pickups.json` and `tee_sign.json` byte for byte.
- **Loader:** add the new sets to `src/entities/kitGraphs.ts`, or put them in a sibling `envGraphs.ts`, using `graphFromSet`.

## Style

- Match shot 03: flat shading, large facets, no textures.
- Colours come from `src/render/biomes.ts` wherever an asset belongs to a biome. Pass them as slot overrides at merge time, never as colours baked per biome into the graph.

## Budgets (triangles, measured by `buildGraph` in the smoke tests)

| Asset | Tris | Asset | Tris |
|---|---|---|---|
| Each tree species | ≤ 200 | Tee riser module | ≤ 24 |
| Bench | ≤ 120 | Path kerb module | ≤ 24 |
| Flagpole + flag | ≤ 80 | Bollard | ≤ 40 |
| Planter | ≤ 100 | Reed clump | ≤ 80 |
| Bag rack (with 2 bags) | ≤ 200 | Each rock | ≤ 60 |
| Welcome sign | ≤ 60 | Each hill card | ≤ 60 |
| Zone stake | ≤ 40 | | |
