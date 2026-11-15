# The Caswell look and detailed grass

Written 2026-11-15, from the user's play-test of Stage 3.5b's water and trees (#89). Their words:
"I want a much better detailed grass texture and the course looking more like the Caswell Pines we
worked on. If needed, use the water like hole 13 and the option I showed from the asset size."

This spec replaces three open entries: `NEXT-SESSION-PROMPT-3.5.md` items 3 and 4 (sand, ground and
grass), and `SPEC-QUEUE.md`'s "ground splat and KTX2" and "grass carpet" rows. The plan is
`docs/superpowers/plans/2026-11-15-caswell-look-and-grass-detail-implementation.md`.

Decisions marked **D** are made here and are the builder's to follow. Items marked **ASK** are
the user's to answer; each has a default the builder uses until they do. Items marked **VERIFY**
must be checked before anyone relies on them.

## 1. What is wrong today

1. **The grass is a flat colour.** `groundShader.ts` paints each surface one palette colour with
   mow stripes on top. Up close, from the Stage 4 chase camera (2.8 m high), the fairway is a
   green plane. The 15 CC0 texture files in `public/textures/terrain/` (19 MB) are loaded by
   nothing.
2. **The course does not look like one place.** The routing is traced from Caswell Pines Golf Club
   in Blanch, North Carolina (`LICENSES.md`), a Gene Hamm course in rolling Piedmont foothills
   among tall loblolly pines, with bentgrass greens. The dressing was written before the tracing
   and follows an invented "course bible": holes 1–5 and 16–18 are parkland, 6–11 are a
   Scottish-style links (tan turf, gorse mounds, grey sky tint), and 12–15 are a marsh (reed
   clumps as trees, near-black water). Six of the eighteen holes are tan with knee-high shrubs.
   Nothing on a real Carolina pine course looks like that.
3. **The woods have no floor.** Trees stand on the same green rough as everything else. Under real
   pines the ground is brown pine straw, and that brown band is most of what makes a pine-lined
   fairway read as one.

## 2. What it should look like

One place: a Carolina Piedmont course in high summer, in the approved soft-bevelled toy style
(`docs/art/STYLE-RESEARCH.md` P1–P6). "Toy style, but richer" (user, 7 Nov) still holds. This is
not photoreal.

| Element | Look |
|---|---|
| Fairway | Bright, warm green. Clear two-tone mow stripes with a real sheen that shifts with the sun, and fine blade grain visible within about 30 m. |
| First cut | A 3–4 m band between fairway and rough, a shade darker than fairway, no stripes. Today the edge is one blend. |
| Rough | Darker, cooler green, visibly coarser: clumpy, with uneven tone at the 5–20 m scale. Tufts of blades near the camera. |
| Green and collar | The lightest, finest surface, cross-mown. A 1.5 m collar of fairway-height grass around it. |
| Bunker | Pale tan sand with rake lines, and a darker raised lip of turf. |
| Woods floor | Rust-brown pine straw under every clump and stand, feathering into the rough over 2–3 m. |
| Trees | Mostly tall pines with a bare trunk and a high crown, with oaks mixed in. No gorse, no reed-trees. |
| Bare ground | Red-orange Piedmont clay where the plan calls for dirt: worn tee surrounds and, later, cart paths. |
| Ponds | Dark, still farm ponds, the hole 13 look, with a cattail fringe. |
| Horizon | Rolling wooded foothills. Already built (`horizon.ts`). |

The art reference for value structure stays `docs/concept/reference/restyle-chase-grey-01.jpg`:
fairway light, rough mid, water dark. Pine straw sits between rough and water.

## 3. Decisions

### 3.1 One look, three variations (D1)

The three biomes stay in the code. `BiomeId`, `BIOME_ROUTING` and every `spec.biome` are
unchanged, because `sim/course.ts` and the briefs carry them and nothing is gained by moving sim
files. **What changes is what the three palettes in `render/biomes.ts` are**: three variations of
the same Piedmont course, not three climates.

| `BiomeId` | Holes | Becomes | Difference from the base |
|---|---|---|---|
| `parkland` | 1–5, 16–18 | **Pine upland.** The base look. | — |
| `links` | 6–11 | **Open upland.** Same greens, same sky. | Slightly warmer, sunnier rough; pines a little sparser (density 4.0, not 1.2); broomsedge-tan patches in the rough. |
| `marsh` | 12–15 | **Bottomland.** The holes with the ponds. | Slightly deeper greens; more oak than pine; cattails at the water. |

Rules for the new palettes:

- Green, fairway and rough differ between variations by **at most 6 in luminance**. The eye should
  not see a border where one stretch meets the next.
- Within a variation, keep the contrast targets recorded in `biomes.ts`' comments: fairway to
  rough at least 25 in luminance, green to fairway at least 20, sand to fairway at least 25.
- `sky` is one colour for all three. Today links is grey and marsh is haze. `sky.ts` already uses
  the parkland sky for the whole match, so this only removes dead variation.
- `treeForm` is `"conifer"` for all three. `TREE_SPECIES.shrub` and `.reed` stay in
  `envGraphs.ts` (the single-hole title backdrop and the gate still load them) but no course hole
  uses them.

The names `links` and `marsh` are now misleading. Renaming them touches `sim/course.ts`,
`sim/briefs.ts` and the committed plans, so it is left to Stage 9 (refactor). Add a comment at
`BIOME_ROUTING` saying what the names mean now.

### 3.2 Ponds take the hole 13 look (D2)

Hole 13 is the cape hole: the fairway bends around a pond on the inside of the turn, and its
water is the dark bottomland colour. The user named it as the reference.

- **Every pond uses one water colour**, a dark olive-brown close to hole 13's today, lifted
  slightly so it is not black: start at `0x4f4a36` and tune on screen. It goes in all three
  palettes' `water` field, so the ground tint under the surface and the surface itself agree.
- `water.ts` keeps its depth ramp, foam and ripples. Its green pull (`waterMid`, written for teal)
  is retuned for the dark colour: shallows show the tinted bed, deep water is nearly opaque.
- Sky reflection rises from 0.2 to about 0.45. Dark still water is mostly reflection, and it is the
  teal that the reflection used to wash out.
- **Cattails:** the course kit already exports reeds (`course_kit.json`, placed by "#55" in the
  old plan). Place them in clusters along each pond's shoreline, on the bank side, from the same
  baked shore data `waterMesh.ts` computes. Decorative, no collider.
- **No new ponds in this spec.** "If needed, use the water like hole 13" is read as: where water
  is wanted, it should look and sit like hole 13's. Adding a cape pond to another hole changes
  the briefs, the terrain and the golden, and the real card has water on 4, 12, 13, 15, 16 and 18
  only, which is what ships. **ASK-2** below covers it.

### 3.3 Textures give detail; palettes give colour (D3)

This is the decision the rest of the ground work hangs on.

A photographic grass texture, sampled as colour, turns the toy course into a scanned lawn and
throws away every contrast value the palettes were tuned for. So **textures are never used as
colour**. Each texture layer is reduced to *detail*: its luminance divided by its own mean, a
number near 1. The surface's colour is still the palette colour, multiplied by that detail:

```
colour = paletteColour * mix(1.0, detail, strength)        // detail = texLuma / layerMean
```

- At `strength` 0 the ground is exactly today's. At 1 it carries the texture's full light-and-dark
  pattern in the palette's hue. Start at 0.55 for grass, 0.7 for pine straw and sand.
- The palette, the stripes, the biome mix and the contrast targets all survive unchanged.
- The normal map does the rest of the work: grain that catches the low sun is what reads as
  "detailed grass", more than colour variation does.

### 3.4 The layers (D4)

Five layers, in this order in both arrays:

| # | Layer | Source (CC0, already in the repo unless noted) | Used on |
|---|---|---|---|
| 0 | Mown grass | `Grass004` | Green, collar, fairway, first cut |
| 1 | Coarse grass | `withered_grass` (detail only, so its brown colour is irrelevant) | Rough |
| 2 | Sand | `Ground093C`. **VERIFY** it reads as raked sand at 0.7 strength; if not, fetch a CC0 sand set from ambientcg.com and record it in `LICENSES.md` and `NOTICE`. | Bunkers |
| 3 | Clay | `Ground071` | Bare ground, slopes steeper than about 35° |
| 4 | Pine straw | **New.** A CC0 forest-floor or pine-needle set from ambientcg.com. **VERIFY** one exists that reads as needles; if none does, use `Ground071` with a procedural needle streak (two rotated high-frequency stripe noises) and say so in the PR. | Woods floor |

`Rock058` is dropped. A Piedmont course has no exposed rock, and steep banks read better as clay.
Its three files leave the repo.

### 3.5 How the textures reach the shader (D5)

- **Two array textures**, so the ground costs two samplers however many layers there are:
  - `uGroundDetail`: `sampler2DArray`, one channel used. R = detail luminance, already divided by
    the layer mean and stored as `detail * 0.5` (so 1.0 is mid-grey, and detail up to 2.0 fits).
  - `uGroundNormal`: `sampler2DArray`, RGBA (three has no three-channel format). RG =
    tangent-space normal xy, B = roughness, A unused.
- Two samplers plus the mask is three. With High's three shadow cascades and the environment map
  the ground stays under ten texture units; WebGL2 guarantees sixteen. Ten separate samplers
  (five colour, five normal) would not fit beside the cascades on iOS.
- **Packed offline** by a script (plan Task 1) into two small binary files, loaded with `fetch`
  and uploaded as `THREE.DataArrayTexture` with mipmaps. No image decoding on the page, no canvas.
- **Sizes: 512 px per layer by default.** Detail array 5 × 512² × 1 byte = 1.3 MB; normal array
  5 × 512² × 4 = 5.2 MB; about 6.5 MB raw and about 8.7 MB of GPU memory with mips. The host
  serves them compressed; expect 3–4 MB on the wire. **VERIFY** the compressed size after Task 1. **ASK-1** covers whether this is the size option
  the user meant.
- **The 19 MB of source JPGs leave `public/`**, so they stop shipping. They move to
  `art/textures-src/`, which the script reads.
- **KTX2 is not used here.** The Stage 4b spec adopts KTX2 for these files "before Stage 5 wires
  them". That order is reversed by this spec, on purpose: `toktx` is not installed in the cloud
  environment and is unverified on the Mac, and the user asked for the grass now. The loader hides
  the format behind one function (`loadGroundTextures`), so Stage 4b swaps the packed files for
  KTX2 arrays without touching the shader. Amend the 4b spec's §4 row to say so.
- **Low loads no textures.** It keeps today's flat ground plus the new palette, first cut and
  collar. `QualityPreset` gains `groundDetail: "off" | "near" | "full"`: Low off, Med near, High
  full.

### 3.6 The shader (D6)

All in `groundShader.ts`, course path only (`options.course`). The one-hole path (title backdrop)
stays flat.

1. **Surface weights**, from the existing mask plus one new vertex attribute:
   - `wGreen`, `wCorridor`, `wSand`, `wWater` as today.
   - **First cut:** a band where `wCorridor` is between 0.30 and 0.62. No new data.
   - **Collar:** a band where `wGreen` is between 0.25 and 0.6. No new data.
   - **Woods floor:** new per-vertex attribute `aWoods` (0..1), baked when a tile's geometry is
     built, from `woodsDensityAt` (§3.7). The mask's four channels are all taken, and tile
     vertices are 2 m apart near the camera, which is fine for a boundary meant to feather.
   - **Clay:** from the geometric normal: `smoothstep(0.78, 0.70, normal.y)` (about 35–45°).
2. **Domain warp.** Before the mask is sampled, the lookup is offset by a low-frequency 2D noise
   of about ±1.2 m, so surface edges wander instead of following the 2 m mask grid. The noise is a
   pure function also written in TypeScript (`groundWarp.ts`) so the grass tufts (§3.8) can ask
   the same question and never stand on what the shader draws as fairway. Water and sand edges
   are **not** warped: the water surface and bunker lips are placed against the unwarped shapes.
3. **Detail sampling**, per pixel, for the one or two layers with the largest weight (not all
   five):
   - **Near:** world XZ × `1 / 3.2 m`.
   - **Macro:** the same layer at `1 / 27 m`, strength 0.35. This is what kills visible tiling
     from the chase camera and gives the rough its clumpy tone.
   - **Anti-tile (High only):** a second near sample, rotated 40° and scaled 1.15, mixed in by a
     low-frequency noise mask.
   - Mown grass is sampled in a frame **rotated to the mow direction**, so the grain runs with
     the stripes.
4. **Mow stripes with sheen.** Today a stripe is a ±7% brightness step. Keep that, and add what
   real stripes are: grass laid in opposite directions. Alternate bands tilt the shading normal
   about ±0.12 along the mow direction and shift roughness by ±0.08. Looking down-sun and up-sun
   the bands then swap, as on a real fairway.
5. **Distance fade.** Detail strength, normal strength and the warp fade to zero between 70 m and
   150 m from the camera, so far ground is today's flat palette and costs one mask sample. Med
   skips the detail fetches entirely past the fade with a branch on distance.
6. **Bunker lip.** Within about 0.8 m outside a sand edge (the mask's sand channel between 0.05
   and 0.5 after mip blur), darken the turf 18%. Sand gets rake lines: a fine stripe pattern
   following the bunker-local direction is not available in the mask, so use a world-space stripe
   at 0.25 m with the domain warp bending it.
7. **Fetch budget per pixel:** Low 1 (mask). Med, within the fade: mask + 2 detail + 2 normal = 5.
   High: mask + 4 detail + 3 normal = 8.

### 3.7 Woods floor data (D7)

`woodsPlacement.ts` gains `buildWoodsDensity(trees, bounds)`: a coarse grid (4 m cells) over the
course where each tree adds a soft disc of radius `1.6 × MIN_SPACING_M + height × 0.25`, then one
blur pass. `woodsDensityAt(x, z)` reads it bilinearly. Pure, three-free, node-tested. It is built
once with the dressing and handed to `createCourseGround`, which bakes `aWoods` per vertex.

The same field later tells Stage 6's route-finding where woods are, so it lives beside the
placement and not in the ground.

### 3.8 Grass tufts (D8)

`render/grassCarpet.ts`, the Stage 5 entry, cut down to what the look needs:

- **Rough and first cut only.** Fairways and greens are mown; blades there would hide the stripes.
  Never on sand, water, clay, pine straw (density × (1 − woods)), or within 2 m of a spawn pad.
- **Tufts, not single blades:** each instance is a small fan of 5 tapered blades (one merged
  geometry, about 30 triangles), 0.18–0.34 m tall. One `InstancedMesh`, one draw.
- **A ring that follows the camera:** 12 m cells out to 48 m. A cell's instances are generated
  from a seeded hash of its cell coordinates when the camera first enters range, and its slot is
  reused when it leaves. No allocation after the pool is built.
- **Colour** comes from `groundColourAt` (plan Task 5), the palette blend in TypeScript, so a tuft
  is the colour of the ground it stands on, a little lighter at the tip.
- **Wind:** the trees' sway function and `uTreeTime`, with amplitude scaled for a 0.3 m blade.
- **Edge fade:** blade height scales to zero over the outer 10 m of the ring.
- **Counts:** `grassDensity` is tufts per square metre of rough: Low 0 (none), Med 1.5, High 4.
  Cap the pool at 22,000 instances on Med and 60,000 on High.

### 3.9 Pines (D9)

- **A loblolly species**, `pine_loblolly`: a bare trunk for the lower 55–60% of its height, then
  three stacked rounded crown masses, slightly irregular. Authored at unit height like the others;
  placed at 11–16 m, against the conifer's 7.5 m, so the woods stand well above the carts.
- `TREE_SPECIES.conifer` becomes `["pine_loblolly", "broadleaf_oak"]`. `conifer_tall` (the
  stacked-cone Christmas tree) stays in `trees.json` for the title backdrop but leaves the course.
- **This is a Blender task and needs a local session.** The rule is that Blender authors
  primitive-graph JSON and the kit script is the source (`HANDOFF.md`, "The direction"). The
  cloud session cannot run Blender. Until the species is exported, the course keeps
  `conifer_tall` at a taller `treeHeight` (10 m); every other part of this spec is independent of
  it.
- The spec for the species goes in `docs/art/specs/stage5/trees.md` beside the others.

## 4. Budgets

| | Low | Med (design target) | High |
|---|---|---|---|
| Ground texture fetches per pixel | 1 | 5 near, 1 far | 8 near, 1 far |
| Ground texture GPU memory | 0 | about 8.7 MB | about 8.7 MB |
| Grass tufts | 0 | up to 22,000 (one draw, about 0.66 M triangles) | up to 60,000 |
| Extra draws | 0 | +2 (tufts, cattails) | +2 |
| Shipped bytes added | 0 | 3–4 MB compressed (6.5 MB raw) | same |
| Shipped bytes removed | 19 MB of unused JPG, all presets | | |

Frame time cannot be measured honestly in the cloud (software GL). Each slice's PR records draw
calls and triangles from `window.__teetimeturrets.perf` at Med, and the user's play-test on a real
GPU is the check on smoothness. If Med drops frames, the levers in order are: tuft cap, fade
distance (70 m → 50 m), macro sample off on Med.

## 5. Not in this spec

- New ponds or any change to hole shapes, briefs or terrain. Sim and golden are untouched by
  every slice.
- Cart paths and tee boxes (`SurfaceId.Tee`, `sim/cartPaths.ts`): still Stage 5, still need their
  own spec. Clay is wired here so they have a surface to use.
- Tree impostors past 250 m and the sight-line dither: Stage 5.
- KTX2: Stage 4b.
- Hole 18's dry hollow (`SPEC-QUEUE.md`): unchanged.
- The Kenney sprite atlas and ambient life (birds, sprinklers): still buildable as written in
  `NEXT-SESSION-PROMPT-3.5.md`, after this.

## 6. Questions for the user

| # | Question | Default until answered |
|---|---|---|
| **ASK-1** | "The option I showed from the asset size": which option was it? It is not recorded in the repo. | 512 px layers packed into two array files, about 6.5 MB raw, as in §3.5. If the option was 1K textures or KTX2, only Task 1's constants and the loader change. |
| **ASK-2** | "Use the water like hole 13": the look only, or also add cape-style ponds to holes that have none? | The look only. The real card has water on 4, 12, 13, 15, 16 and 18, and that is what ships. |
| **ASK-3** | Bentgrass greens are lighter and bluer than the current lime green (`0xa2db31`). Keep the toy lime, or move toward the real thing? | Keep the lime: it is what makes a green findable from across a hole. |
| **ASK-4** | Is a local Blender session available for the loblolly pine, or should the tall-conifer stand-in ship first? | Stand-in ships first. |

## 7. Sources

Course facts in §1 (designer, setting, loblolly pines, bentgrass greens) are from public listings:
visitnc.com, golflink.com and golfnow.com pages for Caswell Pines Golf Club. No image, plat or text
from any of them is in this repository, and none may be added (`LICENSES.md`, "A note on the course
routing").
