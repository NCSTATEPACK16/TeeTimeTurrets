# Trees: two species per biome

**Route:** primitive-graph set → `src/entities/graphs/trees.json`, authored in `art/stage5_kit.py` into collection `trees`.
**Replaces:** the procedural `buildTreeGeometry()` forms in `src/render/Trees.ts`. That function is also consumed by `src/render/treeline.ts`.
**Reference:** `ASSET_PIPELINE.md` §2 budgets trees at "2–3 per biome, primitive-graph, 200 each, must be GPU-instanced". Silhouette briefs are in `docs/COURSE_PIPELINE.md` §7.1: parkland conifer and broadleaf, links low wide scrub (**not trees**), marsh tall narrow reed and willow.

## Why

Every biome today has exactly one crude form (3–4 primitives), so a wood reads as the same tree copied. Two authored species per biome, mixed by a seeded hash, gives the stands variety at an extra cost of one draw per biome in view.

## Contract (keeps `Trees.ts` scaling logic intact)

- **Unit height:** every species is authored so its **top is at y = 1.0**, with its origin at ground contact.
  - `Trees.ts` and `treeline.ts` already scale each instance by `palette.treeHeight` × a per-instance jitter (0.75–1.3). That is unchanged.
  - Links shrubs are wider than they are tall, and that proportion is kept at unit height.
- **Slots:** `tree_trunk`, `tree_foliage_dark` and `tree_foliage_light`. At merge time they are overridden with `palette.trunk`, `palette.foliageDark` and `palette.foliageLight`, so one graph serves every biome it appears in.
- **Graph names** are keyed by `BiomePalette.treeForm`, so no biome palette changes:

| `treeForm` | Species A | Species B |
|---|---|---|
| `conifer` (parkland) | `conifer_tall`: three stacked 7-segment cones, dark below and light on top, slightly offset so the stack isn't a perfect lathe | `broadleaf_oak`: a short trunk plus 3–4 low-segment sphere clumps (6 × 4) at staggered heights, dark lower and light upper |
| `shrub` (links) | `gorse_mound`: 3 overlapping squat spheres with a combined width of about 1.8× their height, and no visible trunk | `pine_windbent`: a trunk leaning about 20° (rotation about X only), with a flat umbrella canopy made from a wide low cone plus a smaller one above |
| `reed` (marsh) | `willow_weeping`: a trunk plus a cone canopy, with 5–6 thin hanging-strand boxes drooping from the rim | `reed_clump`: 7–9 thin tall 4-segment cones at slight tilts (X only), in two tones |

## Wiring (in this stage)

- **`buildTreeGeometry(palette)`** becomes `buildTreeGeometries(palette): [THREE.BufferGeometry, THREE.BufferGeometry]`. It builds with `mergeGraph(graph, overrides)` and takes the geometry. Keep the vertex-colour attribute, because `Trees.ts` renders with vertex colours.
- **`Trees.ts`:** one `InstancedMesh` per species. Choose each instance's species with the existing seeded `random` stream: draw a species bit *after* the draws that already exist, so every current position, scale and rotation stays exactly where it is. The `Trees` interface becomes `meshes: THREE.InstancedMesh[]`; update its callers.
- **`treeline.ts`:** the same, with two meshes per band.
- **Disposal:** every geometry and material, per AGENTS.md.

## Smoke check (15 s or less)

`src/entities/treeGraphs.test.ts` checks, for each of the six species:
- it builds
- its height is 1.0 within 0.02
- its origin is at ground contact (min y within 0.01 of 0)
- it has 200 triangles or fewer
- the links species are wider than they are tall

It also runs one `createTrees` call on a fixed hole, asserting that both species are present and that the total instance count equals today's count, so the positions are unchanged.

## Gate

The existing `hole-ground` and `course-ground` subjects will change, because the trees look different. **Stop and show the new `tools/.gate-out` renders.** Re-baseline only after the user approves. Netlify's build runs the gate.

## Acceptance

A play-tester sees varied stands in each biome, the links reads as treeless scrub, and the frame rate holds on Med.
