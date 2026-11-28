# Handoff — next session

Rewritten 2026-11-23. Slice C of the Caswell look (pine straw and grass tufts, #92) was play-tested ("looks good") and merged. **Next is slice D, loblolly pines, which needs a local Blender session: prompt A in `docs/NEXT-SESSION-PROMPT.md`.** For a cloud session, **3.5c is ready to build** (27 Nov): the spec `docs/superpowers/specs/2026-11-27-mortar-and-capture-flags-design.md` is answered (every default stands; the mortar is on G, since F already fires), and the plan is `docs/superpowers/plans/2026-11-27-mortar-and-capture-flags-implementation.md`. **Slice 1, the flags, is built as draft #100 (27 Nov) and waits on the user's play-test. Do not merge before it.** Slice 2, the player's mortar, follows it.
- **Test time:** `main` ran in 63.0 s on a fresh cloud container, over the cap. #100's Task 0 trimmed it to about 58–60 s on the same machine. Timings vary by about ±3 s between runs there, so compare back to back on one machine, never across sessions. The slowest files are `tools/simAllocation.test.mjs` (24 s, and the Rapier-read warm-up is not where its time goes), `src/sim/arenaGolden.test.ts` (15 s), `src/render/courseGround.test.ts` (18 s), `poolPressure` and `botAcceptance`.
- **Open bug, not 3.5c's:** a headless Turrets match crashes within seconds in a cloud container. Rapier's `world.step` throws "recursive use of an object detected which would lead to unsafe aliasing in rust", then the renderer segfaults. It reproduces on a clean build of `main` (`a9076f9`), from `vite preview` or `vite dev`, and at `quality: "low"`. #98 had a headless match running, so it may be a regression since then. Until it is fixed, nobody can screenshot the arena headless.
  - **Narrowed on 28 Nov.** The browser is Chrome for Testing 153.0.8010.12 (`/opt/pw-browsers/chromium-1243`, both the full binary and the headless shell).
    - With the full binary the first error is `RuntimeError: memory access out of bounds` deep in Rapier's WASM, at about tick 300, a second after FORE! when the first shots go out. Every Rapier allocation after it fails (`setLinvel` from `BallPool.applyRollingResistance`).
    - **The same match is clean without the game around it:**
      - in Node (V8 12.4), 1,200 ticks with the same course, 7 bots, a 60 s clock and a 4 s countdown;
      - in that Chrome, a bare page that builds the course and `Sim` and steps 2,400 ticks, both in a tight loop and yielding with a forced `gc()` every tick.
    - **Ruled out:**
      - the page's `sim` being replaced or disposed mid-match;
      - UI or render code calling Rapier (none does);
      - WASM memory growth semantics (the old buffer detaches as wasm-bindgen expects);
      - V8 flags `--liftoff-only`, `--no-turbofan` and `--no-maglev` (each still crashes).
    - Wrapping `sim.step` in the page (a pass-through closure) stops the crash, which points at the JIT or at timing rather than the sim's logic.
    - Not known: whether a player's Chrome is affected. The user has played the arena without reporting it. Rewrite this file at the end of each session: it is a baton, not a log.

**Also landed (2026-11-25): free drive and the shared title.** The GolfCartSimulator repo moved in as
`drive/` (served at `/drive/`), and the title is now Clubhouse Sunset with Choose Your Ride (Turrets /
Chill / Joyride), and free drive's course is Tee Time Links, with no club name or logo. Why and how: `docs/DECISIONS.md`, "Free drive lives in drive/". Free drive's own
open items (its M2 gate, John's per-hole routing review) are in `drive/docs/handoff/M2.md`, Part F.

**Done (2026-11-27; PR 1 #95, PR 2 #96 and PR 3 #98 all merged): one cart in both games, and hole flags in free drive.** Chill and Joyride get
the Turrets cart (no turret, with the rider, team paint, engine and horn, and wheels that spin and steer in both games). It keeps free drive's
vehicle physics, retuned so Joyride tops out at Turrets' 20 m/s. Free drive gets an oversized waving flag on
every pin (hole number, PAR and a new Tee Time Links logo) and tee signs. Three PRs: the logo, then the flags, then the cart.
Spec: `docs/superpowers/specs/2026-11-25-shared-cart-and-hole-flags-design.md`; prompt D in
`docs/NEXT-SESSION-PROMPT.md`. Independent of slice D and 3.5c, so it can run in any cloud session.

- **PR 1, the logo, merged as #95 (26 Nov).** The design was approved on 25 Nov
  with these choices: one file with two views, the generator committed, free drive showing the logo
  with no banner, and the full name on the compact mark.
  - `art/brand/tee-time-links.svg` is the one file. Its root viewBox is the wordmark; `<view id="mark">`
    is the 256 × 256 compact mark. `art/brand/tee_time_links.py` builds it from the `@fontsource`
    Shrikhand file (Shrikhand as outlines, so there's no `<text>`). Edit the script, not the paths.
  - The Turrets title and free drive's menu import it with `?url`. `src/ui/title/teeTimeLinksLogo.test.ts`
    checks it parses, has its viewBoxes and has no `<text>`. Renders are in `docs/art/brand/`.
- **PR 2, flags and tee signs: merged as #96 (26 Nov).** Free drive only; the root `src/` and the
  golden are untouched.
  - `drive/apps/web/src/env/holeFlags.ts`: a 4 m pole and a 1.6 × 1.1 m cloth on all 18 pins, 2 draws.
    The cloth faces its tee. The face is one canvas atlas: the logo's `#mark`, the number and PAR.
    It is painted after the fonts load and the mark decodes, and is two-sided (the back flips `u` on
    `frontFacing`). The wave is a TSL `positionNode`.
    - **Three 0.186 instances *before* `positionNode`**, so `positionLocal` and `normalLocal` are
      already placed; read the rest shape from `positionGeometry`.
    - `FlagKnocks` is the knock-over (1.5 m, over 1 m/s; falls in 0.4 s, rises from 4 s), stepped
      in `main.ts`'s fixed-step loop.
  - `drive/apps/web/src/env/teeSigns.ts`: Turrets' tee signs ported. The frame is built from
    `src/entities/graphs/tee_sign.json`, imported as data. 2 draws.
    - **Yardage is the user's call this session:** the `hNN-path` length, but never under the
      straight tee-to-pin distance. Some paths start far past their tee (hole 12's, 190 m), and
      hole 1 has no `h01-path`.
    - Each sign faces down the hole, so the spawn on hole 1's tee sees its back.
  - **No level teardown exists in free drive**, so both are disposed on `pagehide` (the user's call).
  - Tunables are in `env/envConfig.ts` (`flags`, `teeSigns`). `env/colouredGeometry.ts`
    (`mergeColoured`) merges solids of several colours into one vertex-coloured draw. PR 3 can use it.
  - Smoke check: `drive/apps/web/test/env/holeFlags.test.ts` (1.3 s), on the shipped packet.
    Screenshots are in `drive/docs/screens/m2/flags/`: WebGL2 headless, because WebGPU had no
    adapter in the container.
- **PR 3, the shared cart: merged as #98 (27 Nov), with no play-test notes left on it.**
  Built from `docs/superpowers/plans/2026-11-26-shared-cart-implementation.md`; the PR body has
  the checks, the deviations and the play-test list.
  - **Model:** `drive/apps/web/src/vehicle/cartGraph.ts` is the WebGPU twin of `buildGraph` and
    `drawBySlot`. `roundedBox.ts` ports three's `RoundedBoxGeometry` (MIT, in `NOTICE`).
    `test/vehicle/cartGraphParity.test.ts` keeps the two builders in step: it compares names, boxes,
    a per-node shape moment, and triangles per slot. Bounds alone missed a changed rbox radius.
  - **`CartView`:**
    - turns the model by π and hides `turret_pivot`;
    - maps wheels to mounts by position;
    - sits the wheel centres on the mounts at rest length;
    - draws 19 meshes.
  - **Physics (`cartTuning.ts`):**
    - Geometry is the model's: wheel radius 0.3, track 1.36, wheelbase 1.54.
    - Joyride is 20 m/s, boost 24. Its water drag doubled with the motor, to keep the M1
      water-entry gate.
    - New `feel` fields: spool, turn bleed and downhill bonus.
    - Steering aims for 2.4 rad/s of heading.
    - **Full lock at 20 m/s spins the cart round** (tilt under 7°). That is the play-test's call.
  - **Paint:** the `PAINTS` table in `src/render/teamColors.ts` (pure data, read by both apps),
    the swatch row on Choose Your Ride, and `&paint=<hex>`.
  - **Sound:** Turrets' engine and honk are in `cartAudio.ts`. The honk is on H and gamepad
    button 2.
  - **Turrets' wheels:**
    - `GolfClub.setWheels` drives one tyre and one rim `InstancedMesh` per cart;
    - `scene.ts` derives spin and steer from each cart's motion;
    - **the cart draw cap is now 21** (`GolfClub.test.ts`);
    - the golden is unchanged.
  - **Root `npm test` ran in 57.7 s**, against the 60 s cap. The next addition to `src/` tests
    should trim the slowest file first.
- **Trap:** free drive's dev server only serves files under `drive/`.
  `drive/apps/web/vite.config.ts` lists `art/brand/`, `src/entities/graphs/` and, since PR 3,
  `src/render/teamColors.ts` in `server.fs.allow`. Anything else shared from the root must be added too, or `pnpm dev` answers 403
  (the build is unaffected, so a build check won't catch it).
- **Headless drive screenshots:** `?view=x,z,height,heading,pitch&level=tee-time-links` skips the menus.
  Many 60 m lines onto a pin run through woods; hole 18 from (−40.25, −144.18), heading 310, is open.

---

**Where it stands:** branch `claude/relaxed-einstein-w3jhbf`, restarted from `main` after #91 merged. Four code commits (straw; tufts; the tuft frame budget and clubhouse clearance; cattail sway and the first-frame fill) and docs. `tsc` is clean and `npm test` passes (125 files, 1,181 tests, 41.3 s against a 60 s cap).

**The work is the Caswell look and detailed grass** (user, 15 Nov). The spec is `docs/superpowers/specs/2026-11-15-caswell-look-and-grass-detail-design.md` and the task-by-task plan is `docs/superpowers/plans/2026-11-15-caswell-look-and-grass-detail-implementation.md`. Four slices, each ending at a play-test stop:

| Slice | State |
|---|---|
| A. Detailed grass (Tasks 1, 2) | **done** (#90) |
| B. One Piedmont course (Tasks 3, 4) | **done** (#91) |
| C. Pine straw and grass tufts (Tasks 5, 6) | **done** (#92) |
| **D. Loblolly pines** (Task 7) | **next; needs a local Blender session** (`NEXT-SESSION-PROMPT.md`, A) |

The spec's §6 has the open questions, each with a default. **`docs/SPEC-QUEUE.md` lists everything else that is left and what still needs a spec.**

## Just done: slice C, pine straw and grass tufts (#92, merged 23 Nov)

Render only. The sim and the golden are untouched.

- **Woods density (`woodsPlacement.ts`: `buildWoodsDensity`, `woodsDensityAt`).** A 4 m grid over the course. Each tree adds a disc of radius `1.6 × MIN_SPACING_M + 0.25 × height`, full inside 85% of it; the sum is clamped to 1 and blurred once (1-2-1 tent). `courseDressing.ts` now places the woods once and builds both the trees and this field from that placement; `CourseDressing.woodsDensity` carries it.
  - The plan's 50% full radius and box blur left lone trees at 0.44. 85% and a tent blur put every tree above 0.70 (lowest 0.707).
- **Pine straw (`groundShader.ts`, course path, every preset).** `aWoods` is baked per tile vertex in `buildGeometry`, straight from the positions, and copied to the skirts. `straw = smoothstep(0.35, 0.7, woods + noise × 0.15) × corridor`, after the rough and before clay, sand and water. Colour `STRAW_COLOUR` 0x8a5a34. Tuning in `GROUND_EDGES.straw*`.
  - **Texture:** ambientCG's only pine-tagged floor, `Ground077` (CC0, in `LICENSES.md` and `NOTICE`). It reads as fine mulch, not needles, so the detail path also draws a needle streak: two sparse sets of short dashes at different angles (`needleStreak`, `GROUND_DETAIL_TUNING.needle*`). Dense dashes read as woven burlap; the fill is 30%.
  - On detail presets slot B switches from coarse grass to straw where straw is over half.
- **CPU palette (`groundPalette.ts`: `groundColourAt`, `strawAmount`).** `courseBlend` transcribed to TypeScript, without stripes or detail. Comments at both say the other exists. Change them together.
- **Grass tufts (`grassCells.ts` pure, `grassCarpet.ts` three).** 12 m cells, a ring of 69 cells (centres within 4.5 cells) round the camera. A cell's tufts come from `hashChannel(seed, 12, cellX, cellZ)`. A tuft stands where the sim says rough, the warped corridor weight is over 0.34, the woods density is under 0.5, with no sand or water and a slope under 35°. It is kept with probability `1 − woods`, halved in the first cut. Its colour is `groundColourAt` × 1.04, and the blades lighten from 0.88 at the root to 1.12 at the tip.
  - One `InstancedMesh` of five-blade fans (20 triangles), in slots of one cell each. A slot keeps its tufts until reused.
  - **Filling is budgeted.** A cell first cost 18 ms on Med (47 ms on High), and two a frame was a 37 ms hitch at every cell crossing. Height, slope and biome now come off a 2 m lattice per cell (6.5 ms a cell on Med). The ring fills 24 candidates at a time under 2 ms a frame (`FILL_BUDGET_MS`), resuming the cell's stream (`fillCellRange`; mulberry32's state steps by a constant, so it can skip ahead). The first update gets 50 ms behind the countdown. Driving at 15 m/s in node: 3.7 ms per update at most. On High the outer cells lag while driving; they are the faded ones.
  - **Clubhouse clearance:** no tuft within `CLUBHOUSE_CLEAR_M` (55 m), the woods' clearance. The spawn pads and the lot are rough to the sim and grew tufts before. The outer 10 m of the 48 m ring shrinks away in the vertex shader. Tufts sway on the trees' wind clock (`TREE_WIND_TIME`) in a world direction. They receive shadows and cast none.
  - `QualityPreset.grassDensity` is Low 0, Med 1.5 and High 4 tufts per m². `grassCap` is 0, 22,000 and 60,000.
  - **Measured in headless Chrome, open rough at (184, −236):** Med, about 19k tufts, 217 → 218 draws, 1.13 M → 1.51 M triangles. High, 55k tufts, 4.18 M → 6.57 M triangles (High's post chain draws the scene twice). Frame time not measured: software GL.
  - The corridor rule never fires on the shipped course: the sim's rough never reaches the drawn fairway. It is kept as a guard. The fairway check fails only with both the surface and corridor rules removed.
- **Cattails sway** (slice B's deviation, fixed): `mergeGraphInstances(..., { baseHeight: true })` writes `aAboveBase`, and `cattails.ts` bends from it on the trees' wind clock, 2.5 cm per m² of height.
- **Smoke checks:** `woodsDensity.test.ts`, `groundPalette.test.ts`, `grassCells.test.ts`, `grassCarpet.test.ts`, `cattails.test.ts`. Each was seen to fail first; `grassCarpet.test.ts` caught `standing` counting slots the ring had left.
  - **Deviation:** on greens the density check asserts "below where straw starts" (density + noise < 0.35), not 0. A few green back edges sit 4–6 m from a clump, and the 4 m grid blurs up to 0.18 onto them.
- **Headless screenshots of the tufts** must pin the tuft ring to the shot camera by replacing `render.grass.update`. Calling it from the shot as well as the scene moves the ring between two places every frame and abandons every half-filled cell. At software GL's 1 fps the ring takes minutes to fill; that says nothing about a real GPU.

## Slice B, one Piedmont course (#91, merged 22 Nov)

**Water-float fix.** The user confirmed it after a play-test: "looks good water wise". The user's play-test: "the water seems to float above the ground". Cause: every pond was drawn at one level, `spec.waterLevel` (-0.72), while the basins around them are carved to different depths and some ground beside a pond sits lower than that. 582 grid cells hung over lower ground. Render only; the golden is untouched.
- `waterMesh.ts` now gives each pond its own level: the lower of its nominal level and the **spill level** of its basin (`spillLevel`, a priority flood over the local ground) minus 4 cm. Only ground connected to the pond's deepest point is water. 2 of 1,684 shoreline points now have lower ground beyond them.
- Levels now range from -2.70 to -0.72 m. Hole 12 (index 11) is unchanged; the others sit 0.6 to 2 m lower. Hole 4's creek-like pond shrinks to a small pool; hole 13's shrinks a lot.
- Cattails stand on ground above the local pond's level (`waterLevelNear`).
- Seen in headless Chrome at holes 18, 15 and 4: water meets the bank with foam at the edge. Not seen on a real GPU.
- **Known mismatch, undecided:** the rules still label ground from the owning hole's pond polygon. About 6,500 m² in the arena zone (the holes 14, 15 and 18 pits) is drawn as water but labelled drivable ground, and about 1,900 m² is the reverse. A real fix is a sim decision (see `SPEC-QUEUE.md`, "Water drawn versus water ruled").

Render only. The sim and the golden are untouched (`sim/course.ts` gained a comment).

- **Palettes (`render/biomes.ts`).** The three biomes are now pine upland, open upland and bottomland: one course in slightly different light. `biomes.test.ts` holds the two rules (at most 6 in luminance between variations; fairway 25 over rough within one). All three grow the conifer pair at 9–10 m, the stand-in until the loblolly exists. The woods went from 1,942 trees to **2,564**; Med's `treeCap` is 2,750.
- **Edges (`GROUND_EDGES` in `groundShader.ts`, course path, every preset).** Fairway, first cut, rough at two cut lines; a collar round each green; stripes stop at the fairway's edge; a darker lip and a cut edge on bunkers; rake lines on detail presets; clay on ground steeper than about 39°. The one-hole path (title backdrop) keeps the old blend.
  - **Deviation:** clay is a colour only. It does not switch detail layer, which would need a third sampled slot.
- **Water (`render/water.ts`).** A GLSL port of afl_ext's ocean, through the user's GolfCartSimulator project, at its still-pond settings (`WATER_TUNING`). `NOTICE` carries the permission notice; it is still to be confirmed against the Shadertoy header.
  - The reflection is three's own Fresnel on `scene.environment`, and the sun's glitter is the scene sun's specular. The source's analytic atmosphere and sun disc were not ported.
  - The scatter term is emissive over a black diffuse. From above, the water is near-black navy; at the chase camera's angle it reflects the sky. That is the source's behaviour too.
  - `waterWaves` exists in TypeScript beside the GLSL as its reference; `water.test.ts` checks them against one set of constants, not against each other's output.
  - `QualityPreset.waterIterations`: 10, 18, 36. Three wave sums a pixel. Not measured on a real GPU.
  - The palettes' `water` field is now a damp-grass olive: it shows on the pond bed and on the strip of bank above the waterline.
- **Cattails (`render/cattailPlacement.ts`, `cattails.ts`).** Placed from `WaterMesh.shore`, a new list of shoreline crossings. One merged draw, 39k triangles. Scaled up and widened 2.4× to read at distance. **No sway** (the plan asked for it).
- **Smoke checks:** `biomes.test.ts`, `water.test.ts`, `cattailPlacement.test.ts`. Each was seen to fail first.
- **A trap from this session:** to see a check fail, break the code with a reversible edit and reverse it. Do not `git checkout` the file afterwards: on an uncommitted file that discards the work.

## Slice A, detailed grass (#90, merged 16 Nov)

Render only. The sim and the golden are untouched.

- **Packer (`tools/textures/packGround.mjs`, `npm run pack:ground`).** Reads the CC0 sets in `art/textures-src/` (moved out of `public/`, so 19 MB stops shipping) and writes `public/textures/ground/detail.bin`, `normal.bin` and `ground.json`: five layers at 512 px, 6.5 MB raw, 4.6 MB gzipped. Needs ImageMagick's `convert`. Deterministic. Rerun it after changing a source or a layer; commit the outputs.
- **Layers (`render/groundLayers.ts`):** mown, coarse, sand, clay, straw. **Straw is packed from clay's files** until Task 5 adds a pine-straw set. The packer has its own copy of the layer order; `tools/groundTextures.test.mjs` fails if the two disagree.
- **Shader (`render/groundShader.ts`, course path).** `QualityPreset.groundDetail`: Low `off` (the old shader, no fetch), Med `near`, High `full`.
  - Palette colour × detail. Mean colour is unchanged (measured: within 2 in 255).
  - Two slots per pixel: mown grass or sand, and coarse grass by rough weight. Plus a 27 m macro sample.
  - All fetches use `textureGrad` with gradients from the world position. Keep it that way: an implicit fetch draws a line where the layer changes.
  - Stripe sheen and layer normals are written to `gNormalTilt` in the roughness chunk and applied after `normal_fragment_maps`. The chunks share globals (`gUvA` and friends) because three compiles them in the order colour, roughness, normal.
  - Tuning is `GROUND_DETAIL_TUNING` in `groundShader.ts` and the per-layer `scaleM` and `strength` in `groundLayers.ts`.
- **Warp (`render/groundWarp.ts`):** the fairway edge wanders up to 1.2 m. The TypeScript function and the GLSL string are built from the same constants on an integer hash. The shader fades the warp out with distance and within 3 m of a tile edge; the TypeScript function does not. Task 6's tufts must allow for that margin.
- **Loading (`render/courseDressing.ts`):** `applyGroundDetail(mode)` fetches the arrays once per page and calls `ground.setDetail`. The ground draws flat until they arrive.
- **Smoke checks:** `tools/groundTextures.test.mjs`, `groundWarp.test.ts`, and one case in `courseGround.test.ts`. Each was seen to fail first.
- **Not measured:** frame time on a real GPU. In headless software GL a Med frame with detail took over 30 s to capture where Low took a second or two, which says software GL is slow at `textureGrad` with anisotropy and nothing about a real GPU. The play-test is the check. If Med drops frames, the levers in order are: `anisotropy` 4 to 1 in `groundTextures.ts`, the fade distance (70 m to 50 m), the macro sample off on Med.
- **Headless screenshots time out at Med and High now.** Give `page.screenshot` a 150 s timeout, and hide the HUD with a style tag to see the ground.

**Asset hosts (checked 8 Nov):** opengameart.org and ambientcg.com (and its download host) answer through the proxy. kenney.nl's tunnel opens but the site returns 403 to scripted requests; Kenney publishes the same CC0 packs on opengameart.org, so fetch them there.

## Read first

1. `AGENTS.md`: the rules, the Claude of Tanks licence note, and the testing policy. Each change gets one smoke check of 15 s or less, and every automated check finishes under 60 s. Smoke, gate and probe are opt-in. The user play-tests at `?match=60`, with items of 60 s or less.
2. **`docs/REVAMP-PLAN.md`:** the master stage order and each stage's contents.
3. **`docs/art/STYLE-RESEARCH.md` and `docs/art/SHEET-REVIEW-2026-10-03.md`:** the approved soft-bevelled style (P1–P6).
4. `docs/DECISIONS.md`, especially "The golden fingerprint is Linux x64's".
5. `docs/TEST-AND-SPEC-PITFALLS.md`, before writing a test or a spec.

## The direction (set by the user; do not relitigate)

- **Arena is the only mode:** 4v4 (the player plus 3 bot allies against 4 bots), 3 minutes. Reaching 0 HP costs your team a stroke; the fewest strokes wins. Friendly fire is off.
- **The arena zone is holes 1, 9, 10, 14, 15 and 18** around the clubhouse, marked with white stakes. **Built in Stage 4.**
- **Style (approved 3 Oct 2026): soft-bevelled toy.** Rounded `rbox` forms, smooth shading by default, AO and contact shade. The team canopy stays full colour.
- **Blender authors primitive-graph JSON only, never meshes.** Each asset has a kit script that is its source.
- **Workflow:** work one stage, run the checkpoint, push, open or update a draft PR, rewrite this file, then **STOP** for the user's play-test. Never merge. Never re-baseline the gate without approval. Never start the next stage without the user saying so.

## Where things stand

| # | Stage | Status |
|---|---|---|
| 1, 2 | Arena finish; juice and audio | **done** (#28, #69) |
| 3 | Foundations: performance and render (#40–#48) | **done** (#71, #83) |
| 5a | Environment art: trees, dressing, horizon, course kit | **done** (#83) |
| 7 | Clubhouse complex and pickups in Blender | **done** (#77, #78) |
| Art v2 | Style research, prompt pack, sheets, P1–P6, cart v3, clubhouse and barn v3 | **done** (#83, #85) |
| 3.5a | Life and intensity: pacing, juice, battlefield presentation | **done** (#87, play-tested 8 Nov) |
| 4 | Handling feel and arena zone (#49–#53) | **done** (#88, play-tested 8 Nov) |
| **3.5b** | **The living course: water, then trees, then sand, then ground and grass (toy style, richer)** | **water and trees done (#89).** Next: the Caswell look and detailed grass, which replaces sand, ground and grass |
| 3.5c | Mortar as a 3-kill streak reward, and capture flags (moves the golden) | after 3.5b |
| 4b | iOS + gamepad, KTX2, size budget (spec `docs/superpowers/specs/2026-11-07-ios-gamepad-and-asset-adoption-design.md`) | after 3.5c. Prompt B in `docs/NEXT-SESSION-PROMPT.md` |
| 5 | Environment, the rest (#54–#61) | after Stage 4b |
| 6 | navGraph (#62–#64) | — |
| 8, 9, 10 | Economy (#66), refactor (#67), docs (#68) | — |

## Earlier in 3.5b: water and trees (#89, merged 15 Nov)

Render only. The sim and the golden are untouched.

- **Water (`render/water.ts`, `render/waterMesh.ts`).**
  - Every pond is one transparent sheet at its hole's water level; all six are one draw of 18.5k triangles.
  - The mesh is a 2 m grid with the water depth baked per vertex. Deep blocks are merged 4 × 4.
  - **The sheet follows `surfaces.surfaceAt`, not the pond polygon.** Hole 18's polygon holds dry fairway below the water level (see `SPEC-QUEUE.md`).
  - The shader patches `MeshStandardMaterial`: wave normals (two layers on High, one elsewhere), a depth colour ramp, foam 0.8 m from the shore, and ripple rings from the last 8 splashes.
  - `EffectsLayer.onSplash` feeds the ripples, so cart and ball splashes both ring.
  - Tuning is `WATER_TUNING` at the top of `water.ts`. Sky reflection is 0.2; at 1 it washed the colour out to pale blue.
  - The biome water colour is sRGB and the shader linearises it. A new per-vertex colour attribute must do the same.
- **Trees (`render/woodsPlacement.ts`, `render/Trees.ts`).**
  - Clumps of 3–7 on a 16 m jittered grid, stands of 6–11 where two holes share the ground, and no two trunks closer than 2.6 m. 1,942 trees (was 1,515), still six instanced draws.
  - A tree stands only where `surfaceAt` is rough and `weights.corridor` is at least `WOODS_WEIGHT`.
  - `flatShading` is gone. Segment counts are raised when the geometry is built (`smoothedGraph`), so `trees.json` is untouched. The oak is now 504 triangles a tree.
  - Per-instance tint, and a wind sway from one shared uniform (`setTreeWindTime`). The treeline shares the material and sways too.
  - `quality.treeCap` is read: `Trees.setCap` drops whole clumps, spread evenly. Med's cap is now 2,000 (all of them), Low 400, High 3,000.
- **Not done from the plan's tree list:** rejection inside the zone's lanes (trees already keep off every corridor, so nothing stands in a lane today), impostors past 250 m, and the sight-line dither. They stay in Stage 5.
- **Smoke checks:** `waterMesh.test.ts`, `woodsPlacement.test.ts`. Both were seen to fail first.
- **Headless screenshots:** the Playwright script from this session is not in the repo. It overrode the camera inside `renderer.render` and called `effects.splash` for the rings. The headless page crashed at match start about one run in three, on `main` too; rerun it.

## Stage 3.5a, as merged (#87)

Countdown, final-30 ramp, streak callouts, hitstop and horn; sprite particles (painted 4 × 2 atlas in `spriteAtlas.ts`, which a CC0 atlas in the same layout can replace); music bed and ambience; distant barrages; knockable tee props. The golden did not move. Capacities are constants in `effects.ts`; wire them to `quality.ts` in 3.5b if Low struggles. Details: `REVAMP-PLAN.md` and `DECISIONS.md` § "Stage 3.5".

**3.5b must respect Stage 4:** trees and any new dressing go outside the zone's lanes (`courseArenaZone(world).contains`), and the chase camera is now 2.8 m high, 0.7 m right of the turret, so judge new ground detail from that angle.

## Stage 4, as merged (#88)

| Art v2 | Style research, prompt pack, sheets, P1–P6, cart v3, clubhouse and barn v3 | **done** (#83, #85) |
| **4** | **Handling feel and arena zone (#49–#53)** | **built; draft PR #88 (branch `claude/sweet-franklin-1vthr8`), CI green, awaiting play-test** |
| 4b | iOS + gamepad, KTX2, size budget (spec `docs/superpowers/specs/2026-11-07-ios-gamepad-and-asset-adoption-design.md`) | **next, after the play-test.** Prompt in `docs/NEXT-SESSION-PROMPT.md` |
| 5 | Environment, the rest (#54–#61) | after Stage 4b |
| 6 | navGraph (#62–#64) | — |
| 8, 9, 10 | Economy (#66), refactor (#67), docs (#68) | — |

Built on branch `claude/sweet-franklin-1vthr8` (the prompt asked for `stage-4-handling-zone`; the cloud session was bound to the other name).

Six commits, one or more per issue. Each sim commit re-recorded the golden itself, because this session ran on Linux x64 with Node 22, which is CI's platform.

- **#49, mobility (`src/sim/mobility.ts`).**
  - Each surface has one number, a resistance: fairway, green and bridge 1, rough 1.4, sand 2, water 3.3.
  - Speed scale is `1 / resistance`. `surfaces.ts` builds its `cartSpeedScale` column from this table, so rough is 0.714 (was 0.72).
  - A tyre's `offRoadPenalty` scales how much of the resistance above 1 it feels. Grip is the vendored `trackGripCoefficient`.
  - The KCC climb limit is now set **per cart per tick** from the vendored uphill margin, instead of a flat 45°.
    - Street tyres: 38.7° on fairway, 29.7° in rough, 21.8° in sand.
    - Knobby tyres: 37.2°, 33.2° and 28.4°.
  - `CART_MAX_SLOPE_CLIMB_DEG` stays exported as the street-on-fairway figure, for the terrain tests and the probe.
  - `SurfaceId` moved to the leaf module `surfaceId.ts`, to avoid an import cycle. `surfaces.ts` re-exports it.
  - Golden: 615753184 → 2980085065.
- **#50, cart feel (`Cart.ts`, all in `CART_TUNING`).**
  - Throttle spool: 25% of the drive is instant, full at 0.6 s. Throttle against the motion is braking and is not spooled.
  - Turn bleed: −15% to the forward cap at full lock and full authority.
  - Downhill bonus: grade × 1.0, capped at 1.15×. Sim samples the grade 1.2 m either side of the cart.
  - Speed over the cap now scrubs off at 8 m/s² instead of snapping to it, so leaving the fairway slows the cart over about 0.7 s.
  - 0 to 20 m/s on the fairway now takes about 1.5 s (was 1.25).
  - Golden: → 4165176536.
- **#51, render only.**
  - `render/cartSuspension.ts`: four-wheel pitch and roll fit, a critically damped 2 Hz spring and a landing dip. The models use rotation order `YXZ`.
  - Chase camera: 2.8 m high (was 3.6) at 6.3 m back (was 6.5), **0.7 m to the turret's right**, and a 19° pitch, which puts the horizon a fifth of the way down the frame.
  - `fitChaseToGround` adds look-ahead over rises, a sight-line lift of up to 3 m, and a pull-in past that.
  - The golden is unchanged.
- **#52, the zone (`src/sim/arenaZone.ts`).**
  - The corridors are padded 22 m and joined to a clubhouse hub, held 8 m north of the road, and traced with marching squares into a 106-vertex polygon (19 ha, 3.8 km of edge).
  - Out of the zone: an immediate HUD warning, then −1 HP every 2 s, and a hard clamp at 30 m.
  - Bots drive at a point 6 m inside the edge nearest a target that is outside. They hold within 8 m of it and ignore balls outside the zone. A bot with no live target now **brakes** instead of coasting.
  - Pickups are placed inside the zone (36 sites, was 56). One call, `coursePickupSites`, serves both the page and the sim.
  - The stakes are the course kit's `zone_stake` every 15 m, with a sagging rope.
  - The golden is unchanged, and that was verified: the 40 s script never leaves the zone or reaches a moved site.
- **#53, checkpoint.** The check outputs are in the PR description.
  - `tsc` is clean, and `npm test` takes 46 s (107 files, 1,120 tests).
  - `tools/simAllocation.test.mjs` passes on Node 22 in 21 s.
  - Build and probe are clean. In this container smoke has failures, and they are environmental: see the PR.

### Known edges (play-test passed; keep an eye on them)

- **The zone's south edge is close behind the barns,** about 14 m behind the team-0 pad, because the road inset clips the hub there. Reversing off the pad puts you out within seconds.
- **Rough now caps climbs at 29.7° for street tyres,** under the KCC's 32° slide angle. Slopes between the two neither climb nor slide. Watch for carts or bots wedged on rough banks.
- **The thin wedge between holes 1 and 9** east of the hub is outside the zone. Stakes run down both sides of it.

## Next: Stage 4b, iOS and gamepad

The prompt is in `docs/NEXT-SESSION-PROMPT.md` and the spec in `docs/superpowers/specs/2026-11-07-ios-gamepad-and-asset-adoption-design.md`. What Stage 4 changed that 4b must respect:

- **Throttle spool resets when the throttle's sign changes or it reaches 0.** An analog stick that jitters around zero would keep restarting it. The gamepad's deadzone must hand the sim a clean 0, not noise.
- **The camera is off-centre.** The chase eye sits 0.7 m to the turret's right, so the screen centre is not the turret line. Aim assist must measure from the turret's yaw, not from the screen centre.
- **`MatchScreen` is unchanged by Stage 4.** The pointer-lock pause is still at `MatchScreen.ts:122`. The zone warning is a HUD element inside `#hud` (`hudState.zoneWarning`), not a screen, so controller navigation does not need to reach it.

## Then: Stage 5, the rest (#54–#61)

The contents are in `REVAMP-PLAN.md` § Stage 5.

- **Environment target:** `restyle-chase-01.jpg`. It shows raised bunker lips, a clear fairway/rough edge, clumps of 3–7 conifers in the rough, rolling hills and AO. Its greyscale (`restyle-chase-grey-01.jpg`) is the value structure to hit. **Don't copy its grey water;** keep shot 03's teal.
- **#56 trees:** `Trees.ts` still sets `flatShading: true` (line 109). Raise the segment counts and drop the flag.
- **Trees must respect the zone:** reject placements in the zone's lanes. `courseArenaZone(world).contains` is there to call.
- **Follow-up after Stage 5 (user, 29 Sep):** push the carts' spawn positions further out. Check them against the zone's south edge, which is close behind the pads (see above).

## What the style pass left in the code (bears on everything visual)

- **`rbox`:** `[w, h, d, radius]`, 108 triangles. A radius at or above half the shortest side throws when the graph loads, because three would clamp it silently. Blender previews it with an unapplied bevel.
- **Smooth by default.** `SlotSpec.flat` is the opt-in. The exporter writes `flat` only when a material sets the custom property `ttt_flat`, so older exports stay byte-identical.
- **Contact shade.** `mergeGraph` and `mergeGraphInstances` darken a graph's bottom 0.6 m (`groundContactShade`) on every preset. Pass `{ contactShade: false }` for anything whose graph space is not metres above the ground; trees (authored at unit height) and pickups (floating) already do. **Any new merged graph that floats or is scaled must opt out.**
- **AO:** `GTAOPass` on High only (`src/render/post.ts`, 1 m radius, scale 1.5), with `QualityPreset.ambientOcclusion` true on High. Med is the design target and has no AO pass, only the contact shade. Whether Med can afford AO is an open question for a later perf pass.
- **The cart's `frame` slot** (formerly `roof`) is slate and no paint touches it. `CHASSIS_PAINTS` sets only `chassis`.

## Audit findings still open (from 2026-09-26)

- **Performance:**
  - Nameplate line of sight runs up to about 3,500 `heightAt` calls per frame.
  - `CourseGround` is rebuilt every match.
  - About 78 draw calls per cart.
  - Near tiles are never evicted.
  - The sim allocates every tick.
  - The bundle is one 3.6 MB chunk.
- **Economy bug** (Stage 8): `clubhouseState.ts` rebuilds owned items from the equipped set, so an earlier purchase is lost when you switch.
- **Paint and skin** never reach the match renderer (Stage 8).
- **Cross-platform sim determinism** is unscheduled. See `DECISIONS.md`.

## Traps

- **Pre-seed the settings to skip the controls card:** `localStorage["teetimeturrets.settings"] = '{"version":2,"quality":"high","seenControls":true}'`. The field is `seenControls`; `controlsSeen` is silently ignored.
- **The desktop app's browser pane, when hidden, shows stale frames.** Before a screenshot, wait two `requestAnimationFrame`s from `javascript_tool`. Keep each script short, because timers are throttled and long awaits time out.
- **`GTAOPass.OUTPUT.Off` blanks the composer chain** (it writes nothing, then swaps). To compare AO on and off, toggle `pass.enabled`.
- **`tools/simAllocation.test.mjs` caps V8 tiering during its measured windows** (fixed 4 Oct, after a CI-only flake in `syncCurrentPool`). If it fails, read its header first: a real per-tick construction shows the same bytes a tick in both windows, as a planted `{t, u}` object did (40.0 and 40.0).
- **Losing the pointer lock mid-match pauses it.** A tool that calls `document.exitPointerLock()` must press RESUME.
- **See every new test fail before trusting it,** and read the red.
- **Vitest hides `console.log`.** To read a number, assert it against an impossible value and read the failure.
- **The golden is Linux x64's.** Re-record it only from Linux x64 (CI or cloud), in the same commit as the change that moves it.
- **Killing preview servers from Bash:** `ps | grep 'vite preview' | kill` matches the shell itself. Kill by PID.
- **Coordinates:** +z is north. `AUTHORED_CLUBHOUSE` is `{x:-241.2, z:-477.3}`. Rough scales cart speed by 0.72.
- **Blender exports read zeros from hidden collections.** `hide_viewport` on a collection drops its objects from the depsgraph, so `matrix_local` stays at identity, and `export_all` silently writes every node at the origin (seen 4 Oct with the tee sign and pickups). Unhide everything before you export, and check `git diff --stat src/entities/graphs/` after each export.
- **`execute_blender_code` after `read_homefile`:** run the build in a *separate* call, because the context is stale in the same call (`'Context' object has no attribute 'active_object'`).
- **Headless hub screenshots:** a scratch Puppeteer script (`.scratch/hubshots.mjs` in the v3 worktree, untracked) overrides the camera inside the frame's render call.
  - On Med, `render.post` is null (there's no composer), so hook `render.renderer.render`.
  - Headless Chrome logs `RuntimeError: memory access out of bounds` at match start on main too. It's not from the kit; the frames still render.
  - The browser pane only returns 480×360 screenshots, and region zoom isn't supported there.
- **Blender ↔ Three:** Three (x, y, z) is Blender (x, −z, y), so the cart's front is −Y in Blender. Rotations are X plus at most one of Y or Z. Call `view_layer.update()` before reading matrices.
- **Git hygiene:**
  - Always use `git commit -s`, including on merge commits (`git commit --amend -s --no-edit`).
  - Never put AI-session metadata in git.
  - Never use `git add -A`, because the main checkout carries an untracked `.scratch/` and `tools/zzshots.mjs`.
- **Local worktrees from the art session** (`TeeTimeTurrets-artdir`, `-style`, `-cart3`) and their `style-dev` and `cart3-dev` entries in `../.claude/launch.json` are merged work and safe to remove. `TeeTimeTurrets-clubhouse3` (`clubhouse3-dev`, port 5184) is merged work too. Port 5183 belongs to another project, so don't reuse it.
- **A cloud session is Linux x64.** It can record the golden itself, in the same commit as the change that moves it. Check `uname -m` first.
- **Headless smoke in a cloud container runs about 1.3 s a frame** on SwiftShader. Checks that hold a key for a fixed time (drive, fire, club select) fail there on `main` as well. To show a change, compare against a `main` worktree in the same container.
- **The zone and the golden:** the golden's 40 s script never leaves the zone, so the golden does not cover zone rules. `arenaZone.test.ts` does.
- **CI runs Node 22; the Mac runs Node 26.** V8-sensitive tests can pass locally and time out on CI. Reproduce with `npx -y node@22 node_modules/vitest/vitest.mjs run <file>`.
