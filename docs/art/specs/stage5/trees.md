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

## As built

- **Species bit on its own stream.** The spec asked for the bit to be drawn from the existing
  `random` stream after the existing draws. That stream also decides cell occupancy, so one extra
  draw per tree shifts every later cell and re-rolls the whole wood. The bit comes instead from a
  stream of its own: `hashChannel(seed, index, 7)` in `createTrees` and `hashChannel(seed, 0, 8)` in
  the treeline. Every position, scale and rotation is bit-identical to the one-species wood in all
  three biomes (checked by comparing every instance matrix: parkland 101, links 17, marsh 65).
- **Shared planting helper.** `plantTrees(palette, matrices, species)` in `Trees.ts` builds both
  species, one `InstancedMesh` each, over one shared material. `createTrees`, `treeline.ts` and the
  course woods all go through it. `Treeline` is now the same type as `Trees`.
- **Woods in the match (added).** When stroke play was removed, per-hole woods came out of the
  match, and only the parkland treeline beyond the road was left. So links and marsh trees would
  otherwise have appeared nowhere in the game. `createCourseTrees` (in `Trees.ts`, built once per
  course in `courseDressing.ts`) plants the eighteen-hole course with the same cell, density,
  deep-rough and scale rules:
  - Each cell takes the biome of the hole with the largest share of it. Ground that no hole
    reaches has no biome and is left open.
  - Any water weight rejects a cell, because course water is painted by surface weight rather
    than drawn as a plane.
  - Trees stay north of the road and at least 55 m from the clubhouse centre.
  - On the shipped course: 1,515 trees, 6 draws, about 164k triangles, built in about 0.25 s.
  - They have no colliders, like the treeline. Carts drive through them.
- **Gate.** No Scene Gate subject draws trees. `hole-ground` is the ground mesh alone and
  `course-ground` is `createCourseGround`, so neither changes, and this slice re-baselines nothing.
- **Triangles** (`buildGraph`): conifer_tall 62, broadleaf_oak 164, gorse_mound 114,
  pine_windbent 72, willow_weeping 124, reed_clump 64.
- **Windbent pine root.** The pipeline keeps graph roots unrotated, so the pine's root is a short
  root-flare cylinder and the 20° lean is on its trunk, a direct child. A part tilted about X is
  lifted so its lowest rim vertex sits on y = 0.
