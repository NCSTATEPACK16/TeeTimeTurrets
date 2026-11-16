# Handoff — next session

Rewritten 2026-11-16, at the end of slice B of the Caswell look (one Piedmont course). It is built, pushed and in a draft PR, **waiting for the user's play-test.** Slice A (detailed grass, #90) was merged at the user's direction without notes. Rewrite this file at the end of each session: it is a baton, not a log.

---

**Where it stands:** branch `claude/relaxed-einstein-w3jhbf`, from `main` after #90 merged. Five commits: palettes, ground edges, the pond shader, the bed tint, cattails. `tsc` is clean and `npm test` passes (120 files, 1,159 tests, 48.9 s; it has ranged from 37 s to 55 s between containers against a 60 s cap).

**The work is the Caswell look and detailed grass** (user, 15 Nov). The spec is `docs/superpowers/specs/2026-11-15-caswell-look-and-grass-detail-design.md` and the task-by-task plan is `docs/superpowers/plans/2026-11-15-caswell-look-and-grass-detail-implementation.md`. Four slices, each ending at a play-test stop:

| Slice | State |
|---|---|
| A. Detailed grass (Tasks 1, 2) | **done** (#90) |
| **B. One Piedmont course** (Tasks 3, 4) | **built, draft PR, awaiting play-test** |
| C. Pine straw and grass tufts (Tasks 5, 6) | next, after the play-test |
| D. Loblolly pines (Task 7) | needs a local Blender session |

The spec's §6 has the open questions, each with a default. **`docs/SPEC-QUEUE.md` lists everything else that is left and what still needs a spec.**

## Just done: slice B, one Piedmont course (draft PR, not merged)

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
