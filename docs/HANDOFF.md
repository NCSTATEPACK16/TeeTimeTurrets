# Handoff — next session

Rewritten 2026-11-07, at the end of the Stage 4 session (handling feel and arena zone, #49–#53). The stage is built, pushed and in a draft PR, **waiting for the user's play-test.** Rewrite this file at the end of each session: it is a baton, not a log.

---

**Where it stands right now:** the PR is [NCSTATEPACK16/TeeTimeTurrets#88](https://github.com/NCSTATEPACK16/TeeTimeTurrets/pull/88), a draft.
- CI is green on its head, which confirms the golden recorded in the cloud (4165176536) on CI's own runner.
- It merges cleanly into `main`, and has no reviews yet.
- Netlify builds a preview of it: https://deploy-preview-88--teetimeturrets.netlify.app/?match=60. The play-test list is in the PR description.

**`docs/NEXT-SESSION-PROMPT.md` holds two paste-ready prompts:**
- **A, Stage 4 play-test fixes.** Use it when the play-test asks for changes. It works on the same branch and PR.
- **B, Stage 4b (iOS and gamepad).** Use it only after the user has signed off Stage 4 and #88 is merged.

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
| **4** | **Handling feel and arena zone (#49–#53)** | **built; draft PR #88 (branch `claude/sweet-franklin-1vthr8`), CI green, awaiting play-test** |
| 4b | iOS + gamepad, KTX2, size budget (spec `docs/superpowers/specs/2026-11-07-ios-gamepad-and-asset-adoption-design.md`) | **next, after the play-test.** Prompt in `docs/NEXT-SESSION-PROMPT.md` |
| 5 | Environment, the rest (#54–#61) | after Stage 4b |
| 6 | navGraph (#62–#64) | — |
| 8, 9, 10 | Economy (#66), refactor (#67), docs (#68) | — |

**Branch note.** The Stage 4 prompt asked for `stage-4-handling-zone`. This session ran in a cloud session that was bound to the branch `claude/sweet-franklin-1vthr8`, so the work and the draft PR are there. Rename it on merge if the name matters.

## Just done: Stage 4 (draft PR #88, not merged)

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

### Watch for in the play-test

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
