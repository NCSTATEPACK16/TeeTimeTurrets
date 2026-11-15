# The Caswell look and detailed grass — Implementation Plan

**Goal:** The course reads as one Carolina Piedmont pine course, and the grass has visible detail
from the chase camera: grain, clumpy rough, striped fairways with sheen, pine straw under the
woods, still sky-reflecting ponds with cattails, and tufts of blades in the rough.

**Spec:** `docs/superpowers/specs/2026-11-15-caswell-look-and-grass-detail-design.md`. Its **D**
decisions are settled. Its **ASK** items have defaults; build to the defaults and list the ASKs
again in each PR.

**Architecture:** Render only. Textures are packed offline into two binary array files, loaded by
one function, and used by `groundShader.ts` as *detail* that multiplies the palette colour. The
palette blend and the edge warp each exist once as a pure TypeScript function with a GLSL twin,
so CPU-placed dressing agrees with the shader. Woods density is a pure grid beside the tree
placement.

**Tech stack:** TypeScript, three.js 0.185 (WebGL2, `DataArrayTexture`), Vitest (node), Vite.
ImageMagick (`convert`) for the offline pack; it is installed in the cloud environment.

## Global constraints

- **The sim and the golden do not move.** No file under `src/sim/**` or `src/physics/**` changes,
  except the one comment at `BIOME_ROUTING` (Task 3). If `arenaGolden.test.ts` changes value, stop:
  something reached the sim.
- **No per-frame allocation** in anything called from `RenderScene.update`. The tuft ring (Task 6)
  builds its pool once.
- **Every `THREE.Mesh`, texture and material has a dispose path.** The ground textures are the
  course's and live as long as the dressing (`courseDressing.ts`), like the ground.
- **One smoke check per task, 15 s or less, seen to fail first** (`docs/TEST-AND-SPEC-PITFALLS.md`).
  A smoke check asserts numbers from pure modules. It never claims the picture is right; the
  play-test does that.
- **`npm test` stays under 60 s** (37 s today). `npx tsc --noEmit` is clean before every commit.
- `git commit -s` on every commit. No AI or session metadata in commits, PR titles or bodies.
  Stage files by name.
- **Blender authors tree geometry.** Do not hand-write a species into `trees.json` (Task 7).
- **Licensing:** any new CC0 texture set is recorded in `LICENSES.md` and `NOTICE` in the commit
  that adds it. Download into a fresh empty directory in the scratchpad, never into the repo
  directly.
- **Stop after each slice** (A, B, C, D below): push, update the draft PR with check outputs, perf
  counters and a play-test list of items 60 s or less at `?match=60`, rewrite `docs/HANDOFF.md`,
  and wait for the user. Do not merge.

## Branch

From `main` **after #89 (water and trees) is merged**. Every task builds on `waterMesh.ts`,
`woodsPlacement.ts` and the smooth tree material from that PR. If #89 is still open with
play-test notes, fix those first on its branch.

## Slices and their play-test stops

| Slice | Tasks | What the user sees |
|---|---|---|
| **A. Detailed grass** | 1, 2 | Grain on fairway and rough, clumpy rough, stripes with sheen. Same colours as today. |
| **B. One Piedmont course** | 3, 4 | No tan links holes or reed-trees. First cut, collar, bunker lips, the hole 13 pond shader, cattails. |
| **C. Woods floor and tufts** | 5, 6 | Pine straw under the trees, blades in the rough. |
| **D. Loblolly pines** | 7 | Tall pines. **Local session with Blender.** |

A is the user's first ask and stands alone. If only one slice fits a session, ship A.

## File structure

**Created**
- `tools/textures/packGround.mjs` — offline packer. Reads `art/textures-src/`, writes the two array files.
- `art/textures-src/` — the CC0 source JPGs, moved from `public/textures/terrain/`.
- `public/textures/ground/detail.bin`, `normal.bin`, `ground.json` — packed arrays and their manifest.
- `src/render/groundTextures.ts` — `loadGroundTextures()`; the only code that knows the file format.
- `src/render/groundLayers.ts` — layer indices, scales, strengths. Pure; shared by shader and tests.
- `src/render/groundWarp.ts` — the edge-warp noise in TypeScript, and its GLSL source as a string.
- `src/render/groundPalette.ts` — `groundColourAt`: the palette blend in TypeScript.
- `src/render/grassCarpet.ts`, `src/render/grassCells.ts` — the tuft ring (three half, pure half).
- `src/render/cattails.ts` — shoreline reed placement and instancing.
- One `*.test.ts` beside each pure module.

**Modified**
- `src/render/groundShader.ts` — detail, sheen, first cut, collar, lip, woods floor, clay, fade.
- `src/render/courseGround.ts` — binds the arrays, bakes `aWoods`, passes the camera position.
- `src/render/biomes.ts` — the three palettes (Task 3).
- `src/render/water.ts` — the hole 13 pond shader (a GLSL port of afl_ext's ocean).
- `NOTICE` — the afl_ext notice.
- `src/render/woodsPlacement.ts` — `buildWoodsDensity`, `woodsDensityAt`.
- `src/render/quality.ts` — `groundDetail`; `grassDensity` gets real values.
- `src/render/courseDressing.ts`, `src/render/scene.ts` — wiring.
- `src/sim/course.ts` — a comment at `BIOME_ROUTING` only.
- `LICENSES.md`, `NOTICE`, `docs/superpowers/specs/2026-11-07-ios-gamepad-and-asset-adoption-design.md` (§4 row), `docs/SPEC-QUEUE.md`, `docs/HANDOFF.md`.

---

## Slice A — detailed grass

### Task 1: Pack the textures and load them

**Files:** `tools/textures/packGround.mjs`, `art/textures-src/**`, `public/textures/ground/*`,
`src/render/groundLayers.ts`, `src/render/groundTextures.ts`, `LICENSES.md`.

- [ ] `git mv public/textures/terrain art/textures-src`. Delete the three `Rock058` files (spec
  D4). Confirm nothing imports the old path: `grep -rn "textures/terrain" src tools` returns only
  docs.
- [ ] `groundLayers.ts` exports the layer table in array order:

  ```ts
  export const GROUND_LAYERS = [
    { name: "mown",   colour: "Grass004_1K-JPG_Color.jpg",   normal: "Grass004_1K-JPG_NormalGL.jpg",   rough: "Grass004_1K-JPG_Roughness.jpg",   scaleM: 3.2, strength: 0.55 },
    { name: "coarse", colour: "withered_grass_diff_1k.jpg",  normal: "withered_grass_nor_gl_1k.jpg",   rough: "withered_grass_rough_1k.jpg",     scaleM: 4.0, strength: 0.55 },
    { name: "sand",   colour: "Ground093C_1K-JPG_Color.jpg", normal: "Ground093C_1K-JPG_NormalGL.jpg", rough: "Ground093C_1K-JPG_Roughness.jpg", scaleM: 2.4, strength: 0.7 },
    { name: "clay",   colour: "Ground071_1K-JPG_Color.jpg",  normal: "Ground071_1K-JPG_NormalGL.jpg",  rough: "Ground071_1K-JPG_Roughness.jpg",  scaleM: 3.0, strength: 0.6 },
    { name: "straw",  /* Task 5 fills this in; until then it repeats clay's files */ ... },
  ] as const;
  export const LAYER = { mown: 0, coarse: 1, sand: 2, clay: 3, straw: 4 } as const;
  export const GROUND_TEXTURE_SIZE = 512;
  export const MACRO_SCALE_M = 27; export const MACRO_STRENGTH = 0.35;
  export const DETAIL_FADE_START_M = 70; export const DETAIL_FADE_END_M = 150;
  ```
- [ ] `packGround.mjs` (run by hand, `node tools/textures/packGround.mjs`; add `npm run pack:ground`):
  1. For each layer, use `convert` to resize colour, normal and roughness to 512 × 512 and emit raw
     bytes (`-depth 8 gray:-` for colour luminance and roughness, `rgb:-` for normal).
  2. **Detail channel:** luminance in linear light (decode sRGB first), divided by the layer's mean,
     times 0.5, clamped to 0..1, to a byte. Record the pre-normalisation mean in the manifest.
  3. **Make each layer tile-safe at low frequency:** subtract a heavily blurred copy (radius 64 px)
     and add back its mean, so no layer carries a light-to-dark gradient that would show as a
     repeat every 3 m. Do this before step 2.
  4. Write `detail.bin` (5 × 512 × 512 bytes, layers in order) and `normal.bin` (5 × 512 × 512 × 4:
     normal x, normal y, roughness, 255).
  5. Write `ground.json`: `{ size, layers: [{name, mean}], detailBytes, normalBytes }`.
  The script is deterministic: running it twice gives byte-identical files. Commit the outputs.
- [ ] `groundTextures.ts`:

  ```ts
  export interface GroundTextures { readonly detail: THREE.DataArrayTexture; readonly normal: THREE.DataArrayTexture; dispose(): void; }
  export async function loadGroundTextures(baseUrl: string): Promise<GroundTextures | null>
  ```
  `fetch` the manifest and both files, check the byte lengths against the manifest, build two
  `DataArrayTexture`s: `RedFormat` for detail, `RGBAFormat` for normal (three has no
  three-channel format, so the packer writes a fourth byte of 255). `RepeatWrapping`,
  `LinearMipmapLinearFilter`, `generateMipmaps = true`, anisotropy 4, `NoColorSpace`. Return
  `null` on any failure; the ground then draws flat, exactly as today.
- [ ] **Smoke check** `groundTextures.test.ts` (node, reads the committed files with `fs`):
  the manifest's byte counts match the files; every layer's mean detail byte is within 127 ± 6
  (the normalisation worked); the left and right halves of each layer differ in mean by under 3%
  (step 3 worked). See it fail by skipping step 3 in the packer for one layer.
- [ ] Record in `LICENSES.md` that the sources now live in `art/textures-src/` and that the
  shipped files are derived from them.
- [ ] Commit: `tools, render: pack the CC0 ground textures into two array files`.

### Task 2: Grass detail in the ground shader

**Files:** `src/render/groundShader.ts`, `courseGround.ts`, `quality.ts`, `courseDressing.ts`,
`scene.ts`, `groundWarp.ts`.

- [ ] `quality.ts`: add `groundDetail: "off" | "near" | "full"` (Low off, Med near, High full).
  Update `quality.test.ts`' monotonic check.
- [ ] `courseDressing.ts` loads the textures once per course, when `groundDetail` is not `"off"`,
  and hands them to the ground with `ground.setDetail(textures, mode)`. The load is async: the
  ground draws flat until it resolves, then every tile material gets `needsUpdate` once. The
  textures are disposed with the dressing, not with a match.
- [ ] `courseGround.ts`: shared uniforms gain `uGroundDetail`, `uGroundNormal`, `uCameraPos`
  (a `Vector3` the scene updates each frame; no allocation) and `uDetailMode`. The program cache
  key becomes `course-ground-${mode}` so the three modes compile separately and every tile still
  shares one program.
- [ ] `groundWarp.ts`: `groundWarp(x, z, out)` returns the ±1.2 m offset from two octaves of value
  noise at 1/19 m and 1/7 m, and exports `GROUND_WARP_GLSL`, the same function as a string, built
  from the same constants. The hash must be one that matches bit-for-bit closely enough between
  JS and GLSL: use an integer-lattice hash on `floor()` coordinates with `fract(sin(dot))`
  avoided; a small integer hash (`uint` in GLSL ES 3.0, `Math.imul` in JS) is exact in both.
- [ ] `groundShader.ts`, course path, inside the existing `map_fragment` replacement:
  1. Compute `dist = distance(uCameraPos.xz, vGroundWorldPos.xz)` and
     `fade = 1 - smoothstep(FADE_START, FADE_END, dist)`.
  2. Warp the mask lookup for the green and corridor channels by `groundWarp * fade`. Sample sand
     and water unwarped (two mask fetches where the warp is non-zero; one beyond the fade).
  3. Pick the detail layer: `coarse` weight = `wCorridor`, `mown` = `1 - wCorridor`; sand
     overrides both. (Straw and clay arrive in Tasks 4 and 5.)
  4. `detail = texture(uGroundDetail, vec3(uvNear, layer)).r * 2.0`, plus the macro sample;
     combine as `mix(1, near, strength) * mix(1, macro, MACRO_STRENGTH)`, then
     `mix(1, that, fade)`. On `"full"`, add the rotated anti-tile sample.
  5. The mown layer's UV is rotated into the mow frame: `uv = vec2(dot(p, dir), dot(p, perp)) / scaleM`.
  6. `diffuseColor.rgb *= grass * detail` where `grass` is today's palette-and-stripe result.
- [ ] In a `normal_fragment_maps` replacement: sample `uGroundNormal` for the chosen layer,
  build a world-space perturbation (the ground is close to flat, so tangent = world X, bitangent
  = world Z is good enough; say so in a comment), scale by `fade`, and add the **stripe sheen**:
  tilt along `fairwayDir` by `±0.12 * mownAmount * fade` with the sign from the stripe band.
  Roughness: the layer's B channel, shifted `±0.08` by band.
- [ ] `scene.ts`: copy the camera position into the ground's `uCameraPos` after `frameChase`.
- [ ] **Smoke check** `groundWarp.test.ts`: the warp is bounded by 1.2 m over 10,000 points, is
  continuous (two points 1 cm apart differ by under 2 cm), and is deterministic. Plus one
  assertion in `courseGround.test.ts` that every tile material shares one `customProgramCacheKey`
  per mode. See the bound fail by doubling an octave's amplitude.
- [ ] **Look at it** headlessly at Med and High from the chase camera on hole 1's fairway and in
  the rough beside it, with detail on and off, and attach the four frames to the PR. Check for:
  visible tiling at 3 m or 27 m, shimmer at distance (raise mip bias or shorten the fade), and
  stripes that still read at 100 m.
- [ ] Record from `window.__teetimeturrets.perf` at Med: draw calls, triangles, texture count.
- [ ] Commit: `render: grass grain, clumpy rough and striped sheen from packed detail textures`.

**STOP A.** Play-test list: does the fairway show grain near the cart; does the rough look
coarser than the fairway; do the stripes swap light and dark when you turn around; any visible
repeating pattern; any shimmer in the distance; is Med still smooth; does Low look as before.

---

## Slice B — one Piedmont course

### Task 3: The palettes

**Files:** `src/render/biomes.ts`, `src/sim/course.ts` (comment only), `src/render/Trees.ts` tests
if they assert on links' or marsh's density.

- [ ] Rewrite the three palettes per spec D1. Starting values, to tune on screen:

  | Field | `parkland` (pine upland) | `links` (open upland) | `marsh` (bottomland) |
  |---|---|---|---|
  | `green` | `0xa2db31` | `0xa6dc36` | `0x9cd630` |
  | `fairway` | `0x5fa53a` | `0x66a83c` | `0x599e39` |
  | `rough` | `0x4f7a3a` | `0x587f3a` | `0x49723a` |
  | `sand` | `0xe2cfa0` | `0xe2cfa0` | `0xdcc898` |
  | `water` | `0x3f5560` | `0x3f5560` | `0x3f5560` |
  | `sky` | `0x55b1ef` | `0x55b1ef` | `0x55b1ef` |
  | `foliageLight` | `0x5f9636` | `0x679a38` | `0x588c36` |
  | `foliageDark` | `0x3c5c28` | `0x42602a` | `0x36542a` |
  | `trunk` | `0x6b4a36` | `0x6b4a36` | `0x5e4333` |
  | `treeDensity` | 5.5 | 4.0 | 5.0 |
  | `treeHeight` | 10 | 10 | 9 |
  | `treeForm` | `conifer` | `conifer` | `conifer` |

  Rough is darkened from `0x59823f` so pine straw (Task 5) has room between rough and water.
  Replace the long comments on `links` and `marsh` with what each variation is now and the two
  rules (6 between variations, the within-variation contrast targets).
- [ ] Add the comment at `BIOME_ROUTING` in `sim/course.ts`: the ids are stretches of one course;
  the names are historical; see this spec. No code change.
- [ ] **Smoke check** `biomes.test.ts` (new or extended): luminance (Rec. 709 on sRGB bytes, the
  measure the existing comments use) of green, fairway and rough differs by at most 6 between any
  two palettes; within each, fairway − rough ≥ 25, green − fairway ≥ 20, sand − fairway ≥ 25; all
  three `water` and `sky` values are equal; every `treeForm` is `conifer`. See it fail against the
  old palettes before changing them (write the test first).
- [ ] Run the tree tests; `woodsPlacement.test.ts` asserts more than 1,200 trees and will now see
  more (links density rose). Update no threshold unless one fails, and if `Trees.setCap` at Med
  (2,000) now drops clumps, raise Med's `treeCap` to the new count rounded up to the next 250 and
  record the new count in the PR.
- [ ] Commit: `render: one Piedmont palette in three variations`.

### Task 4: Edges, ponds and cattails

**Files:** `groundShader.ts`, `water.ts`, `cattails.ts`, `waterMesh.ts`, `scene.ts`.

- [ ] `groundShader.ts`:
  - **First cut:** `firstCut = smoothstep(0.30, 0.38, wCorridor) * (1 - smoothstep(0.54, 0.62, wCorridor))`.
    Colour `mix(cFairway, cRough, 0.35)`; no stripes (`mownAmount *= 1 - firstCut`); mown detail
    layer at coarse scale.
  - **Collar:** the same construction on `wGreen` between 0.25 and 0.6, coloured as fairway,
    stripes off.
  - **Bunker lip:** `lip = smoothstep(0.05, 0.3, sandBlurred) * (1 - smoothstep(0.3, 0.5, sandBlurred))`
    where `sandBlurred` is the sand channel sampled at mip bias +1.5. Darken turf by 18% there.
  - **Rake lines** on sand: a 0.25 m stripe in warped world space, ±6%.
  - **Clay** on steep ground from `vNormal` in world space (pass a world-normal varying), layer
    `clay`, colour a fixed `0xb5562f` uniform, not per biome.
- [ ] `water.ts`: port the afl_ext ocean shader per spec D2. The source to read is
  `apps/web/src/env/oceanWaves.ts` in `NCSTATEPACK16/GolfCartSimulator` (attach that repo to the
  session, read access); the settings are in its `env/envConfig.ts` and repeated in the spec.
  1. Add GLSL `waterWaves(vec2 p, float time)` (the `exp(sin(x) - 1)` sum with drag; iteration
     count a `#define` from `quality.waterIterations`) to the fragment `common` block.
  2. In the normal block, replace `waterSlope` with the three-sample normal:
     `pos = world.xz * waveScale`, `depth = waveHeight * waveScale`, `e = 0.01`; then flatten
     toward +Y by `distanceSmoothing * min(1, sqrt(dist * 0.01) * 1.1)`. Add the ripple-ring slope
     to the result as today.
  3. Colour: drop the depth colour ramp. `diffuseColor.rgb = scatterColor * scatterStrength * (h0 + 0.2)`,
     `roughness` near 0.05 and `envMapIntensity` 1 so three's own Fresnel reflects
     `scene.environment`; add the sun disc `pow(max(0, dot(reflect(ray, n), sunDir)), 720) * 210`
     into `totalEmissiveRadiance`, scaled by the Fresnel term. `uSunDir` is `sky.sunDir`.
  4. Alpha: 1 everywhere except the shoreline fade and foam, which stay.
  5. `quality.ts`: replace `water: "flat" | "reflective"` with `waterIterations` (10, 18, 36).
  6. `NOTICE`: add the afl_ext notice in this commit (spec D2, Licence).
  Compare against `docs/screens/water/h13-chase.png` on that repo's branch
  `claude/sweet-rubin-u1g5bl`, on holes 13, 15 and 18 at Med and High. If the baked environment
  reads as a flat colour in the reflection, port the source's analytic `atmosphere()` too.
- [ ] `waterMesh.ts` exports the shoreline: while building, collect points where a cell edge
  crosses depth 0 between a wet and a dry vertex (`shore: Float32Array` of x, z pairs).
- [ ] `cattails.ts`: thin the shore points to one cluster site every 5–9 m (seeded), step each
  1.0–1.6 m toward the bank side (the dry vertex's direction), and place 3–6 reeds per cluster
  from the course kit's reed graph with `mergeGraphInstances`. One draw. `contactShade: false` is
  not needed (they stand on ground in metres), but they must use the tree wind material so they
  sway. Dispose path as for trees.
- [ ] **Smoke check** `cattails.test.ts` on the shipped course: every cluster site is on ground
  the sim does not call water, within 2.5 m of a shore point, and every pond with a shore has at
  least 3 clusters. See it fail by stepping toward the wet side.
- [ ] Commit(s): `render: first cut, collars, bunker lips and clay`, then
  `render: the hole 13 pond shader on every pond, with a cattail fringe`.

**STOP B.** Play-test list: do holes 6–11 now look like the same course as 1–5; can you still
tell fairway from rough at a glance on every stretch; is the first cut visible; do bunkers have a
lip; do the ponds look like the hole 13 pond in GolfCartSimulator (still, reflecting the sky, with ripples and sun glitter); cattails present and not in
the water; drive from hole 5 to hole 6 and from 11 to 12: is there a visible seam.

---

## Slice C — woods floor and tufts

### Task 5: Pine straw under the trees

**Files:** `woodsPlacement.ts`, `courseGround.ts`, `groundShader.ts`, `groundLayers.ts`,
`packGround.mjs`, `groundPalette.ts`, `LICENSES.md`, `NOTICE`.

- [ ] **The straw texture (VERIFY).** Search ambientcg.com for a CC0 pine-needle or forest-floor
  set (try "pine needles", "forest floor", "Ground" sets tagged needles). Download the 1K JPG zip
  into a fresh scratchpad directory, read its licence line, and copy the three maps into
  `art/textures-src/`. Re-run the packer. Record the asset ID and URL in `LICENSES.md` and
  `NOTICE` in the same commit. If nothing reads as needles, keep clay's files for the layer, add
  the procedural needle streak in the shader, and say so in the PR.
- [ ] `woodsPlacement.ts`: `buildWoodsDensity(trees, bounds): WoodsDensity` and
  `woodsDensityAt(field, x, z): number` per spec D7. 4 m cells; each tree stamps a disc with a
  smooth falloff; one 3 × 3 blur; values clamped to 0..1.
- [ ] `courseDressing.ts` builds the field from the placed trees (the placement must now be kept,
  not thrown away after instancing) and passes it to `createCourseGround`.
- [ ] `courseGround.ts`: bake `aWoods` (normalised `Uint8`) per vertex in both near and far
  geometry, and copy it onto skirt vertices like `aBiome`.
- [ ] `groundShader.ts`: `straw = smoothstep(0.35, 0.7, vWoods + (noise − 0.5) * 0.3) * wCorridor`,
  so the floor feathers and never reaches mown grass. Colour: a uniform `0x8a5a34`, the same for
  every variation. Layer `straw`, strength 0.7. Straw overrides coarse grass; sand, water and clay
  override straw.
- [ ] `groundPalette.ts`: `groundColourAt(sample, out)`, the palette blend in TypeScript, taking
  the surface weights, the biome shares and the woods density and returning linear RGB: green →
  fairway → rough, first cut, collar, straw, sand, water, in the shader's order, **without**
  stripes or detail. Write it by transcribing the GLSL, and put a comment at both saying the other
  exists.
- [ ] **Smoke check** `woodsDensity.test.ts` on the shipped course: density is above 0.7 at every
  tree's own position, is 0 on every fairway centreline sample and on every green, and its mean
  over the course is between 0.03 and 0.25. Plus `groundPalette.test.ts`: at full fairway weight
  it returns the fairway colour, at full rough the rough colour, at full woods the straw colour.
  See the first fail by dropping the stamp radius to 0.
- [ ] Commit: `render: pine straw under the woods`.

### Task 6: Grass tufts

**Files:** `grassCells.ts`, `grassCarpet.ts`, `quality.ts`, `scene.ts`.

- [ ] `quality.ts`: `grassDensity` Low 0, Med 1.5, High 4 (tufts per m² of rough). Add
  `grassCap`: 0, 22,000, 60,000.
- [ ] `grassCells.ts` (pure): 
  - `CELL_M = 12`, `RING_CELLS = 4` (48 m).
  - `fillCell(cellX, cellZ, density, query, out): number` writes up to `ceil(density * 144)`
    tufts into a caller-owned `Float32Array` (x, y, z, yaw, height, r, g, b per tuft) and returns
    the count. Positions come from `mulberry32(hashChannel(seed, GRASS_CHANNEL, cellX, cellZ))`;
    pick a channel number that `grep -rn "hashChannel(" src` shows is free.
  - A candidate is kept when `query` says: surface is rough, the **warped** corridor weight (use
    `groundWarp`) is above 0.34, woods density is below 0.5, not water, not sand, slope below 35°.
    Keep probability scales with `(1 − woods)` and with the first-cut band at half density.
  - Colour from `groundColourAt`, tip lightened 12%.
  - `ringCells(cameraX, cameraZ, out)`: the cell coordinates within the ring, nearest first.
- [ ] `grassCarpet.ts`: one tuft geometry (5 tapered blades in a fan, each 2 quads, bent outward;
  unit height), one `InstancedMesh` sized to `grassCap`, one material: the tree wind material's
  sway with amplitude 0.12, `instanceColor`, double-sided, no shadow casting.
  - A slot table maps cell key → instance range. On `update(cameraX, cameraZ)`: if the camera's
    cell has not changed, return. Otherwise free ranges of cells that left, fill at most **two**
    new cells per frame into freed ranges, set `instanceMatrix.needsUpdate` with an update range
    covering only what changed, and set `mesh.count` to the high-water mark.
  - All scratch (`Float32Array` per cell, `Matrix4`, `Color`) is allocated in the constructor.
  - Height fades to 0 over the outer 10 m of the ring, in the vertex shader from `uCameraPos`.
  - `dispose()` frees geometry, material and the mesh.
- [ ] `scene.ts`: construct when `quality.grassDensity > 0`, update after `frameChase`, dispose.
- [ ] **Smoke check** `grassCells.test.ts` on the shipped course, on a cell in hole 1's rough and
  one on its fairway: the fairway cell yields 0 tufts; the rough cell yields between 40% and 100%
  of `density × 144`; every tuft is on rough and off water; the same cell fills identically twice;
  `ringCells` returns 69 or fewer cells and the first is the camera's own. See it fail by removing
  the corridor test.
- [ ] `tools/simAllocation.test.mjs` covers the sim, not the renderer. For the renderer, add one
  assertion to `grassCells.test.ts`: 200 calls to `fillCell` with the same `out` leave
  `out.buffer` identical in identity and length.
- [ ] Record draw calls and triangles at Med from the perf hook, tufts on and off.
- [ ] Commit: `render: tufts of grass in the rough, in a ring around the camera`.

**STOP C.** Play-test list: is there brown straw under every clump and none on a fairway; do tufts
appear in the rough near the cart and not on fairways or greens; do you see them pop in while
driving; do they hide carts or balls (they must not: lower the height if so); is Med still
smooth with tufts on; on Low is everything still fast.

---

## Slice D — loblolly pines (local, Blender)

### Task 7: The species

Needs the Blender MCP session on the user's Mac. Do not attempt in the cloud.

- [ ] Write the species into `docs/art/specs/stage5/trees.md` (proportions from spec §3.9): unit height; trunk a tapered
  cylinder to 0.58 of the height, radius 0.035 at the base; three crown masses (flattened spheres
  or short wide cones with rounded tops) at 0.62, 0.78 and 0.92, radii 0.20, 0.17, 0.11, each
  offset a few percent off-axis; slots `tree_trunk`, `tree_foliage_dark`, `tree_foliage_light`
  (top mass light). Budget 220 triangles after `smoothedGraph`.
- [ ] Add it to the trees kit script (the script is the source), rebuild from an empty file per
  `HANDOFF.md`'s Blender traps (unhide every collection before export; run the build in a separate
  call after `read_homefile`), export, and check `git diff --stat src/entities/graphs/` shows only
  `trees.json`.
- [ ] `envGraphs.ts`: `TREE_SPECIES.conifer = ["pine_loblolly", "broadleaf_oak"]`. `biomes.ts`:
  `treeHeight` 14, 14, 12. `woodsPlacement.ts`: `PURE_CONIFER_SHARE` stays 0.8.
- [ ] The wind sway bends by height squared; on a 14 m tree the crown moves 0.3 m. Check it does
  not look like rubber; halve `SWAY_AMPLITUDE` for species taller than 10 m if it does.
- [ ] **Smoke check:** extend `Trees.test.ts`' existing colour-bake test to the new species, and
  assert its merged triangle count is under 260.
- [ ] Commit: `art, render: loblolly pines`.

**STOP D.** Play-test list: do the woods read as tall pines; can you see under the crowns to the
next fairway (you should); does the treeline beyond the road match; do trees hide the camera's
view of your own cart.

---

## Task 8: Record it (end of each slice)

- [ ] `docs/HANDOFF.md`: rewrite for the slice just finished.
- [ ] `docs/SPEC-QUEUE.md`: move "ground splat and KTX2" and "grass carpet" to done as their
  slices land; note that Stage 4b now converts the packed arrays to KTX2, not the JPGs.
- [ ] After slice A, amend the Stage 4b spec's §4 KTX2 row: the sources are in
  `art/textures-src/`, the game loads `public/textures/ground/*.bin` through
  `loadGroundTextures`, and the swap is inside that function.
- [ ] `docs/DECISIONS.md`: one entry, "Textures are detail, not colour", with the reason from
  spec §3.3, and one for "One course, three variations".
- [ ] `docs/REVAMP-PLAN.md` § Stage 5: strike the splat and grass bullets and point here.

## Self-review

- **Where this plan is most likely wrong:** the JS/GLSL warp agreement (Task 2). If the two
  drift, tufts stand on drawn fairway. Task 6's corridor threshold (0.34) sits 0.04 inside the
  first cut's start on purpose, as margin. If the integer hash proves awkward in GLSL, drop the
  warp from the mask lookup entirely and keep straight edges; nothing else depends on it.
- **The per-pixel layer choice** (Task 2 step 3) samples one layer and cross-fades by weight only
  near boundaries. If a seam shows where rough meets fairway, sample both layers within the
  blend band; that is the High path's cost on Med, so measure before keeping it.
- **Nothing here is evidence about the sim.** Every check is on pure render-side modules or on
  the shipped course's own data.
