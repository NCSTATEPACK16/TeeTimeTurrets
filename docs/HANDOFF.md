# Handoff — next session

Rewritten 2026-10-04, after PR #83 merged (`c09e756`). That PR combined Stage 3b, Stage 5a, the art-direction v2 work, the style pass and cart v3. Rewrite this file at the end of each session: it is a baton, not a log.

---

**Paste-ready prompts** for the next two sessions are in `docs/NEXT-SESSION-PROMPT.md`: A is the clubhouse and barn v3 pass (local), B is Stage 4.

## Read first

1. `AGENTS.md`: the rules, the Claude of Tanks licence note, and the testing policy. Each change gets one smoke check of 15 s or less, and every automated check finishes under 60 s. Smoke, gate and probe are opt-in. The user play-tests at `?match=60`, with items of 60 s or less.
2. **`docs/REVAMP-PLAN.md`:** the master stage order and each stage's contents.
3. **`docs/art/STYLE-RESEARCH.md` and `docs/art/SHEET-REVIEW-2026-10-03.md`:** the approved soft-bevelled style (P1–P6) and why the old flat-faceted rule was wrong. Everything visual follows from them.
4. `docs/DECISIONS.md`, especially "The golden fingerprint is Linux x64's".
5. `docs/TEST-AND-SPEC-PITFALLS.md`, before writing a test or a spec.

## The direction (set by the user; do not relitigate)

- **Arena is the only mode:** 4v4 (the player plus 3 bot allies against 4 bots), 3 minutes. Reaching 0 HP costs your team a stroke; the fewest strokes wins. Friendly fire is off.
- **The arena zone is holes 1, 9, 10, 14, 15 and 18** around the clubhouse, marked with white stakes. It lands in Stage 4.
- **Style (approved 3 Oct 2026): soft-bevelled toy.**
  - Chunky forms with rounded edges (`rbox`).
  - Smooth shading by default; a slot opts into facets with `flat`.
  - The look comes from bevels plus lighting, meaning AO and contact shade.
  - **The team canopy stays full colour** (decided from `cart-v3-distance-01.jpg`).
- **Blender authors primitive-graph JSON only, never meshes.** Each asset has a kit script that is its source; edit the script, not the `.blend` by hand.
- **Workflow:** work one stage, run the checkpoint, push, open or update a draft PR, rewrite this file, then **STOP** for the user's play-test. Never merge. Never re-baseline the gate without approval. Never start the next stage without the user saying so.

## Where things stand

| # | Stage | Status |
|---|---|---|
| 1, 2 | Arena finish; juice and audio | **done** (#28, #69) |
| 3 | Foundations: performance and render (#40–#48) | **done**. 3a in #71; 3b in #83 |
| 5a | Environment art: trees, dressing, horizon, course kit | **done** (#83) |
| 7 | Clubhouse complex and pickups in Blender | **done** (#77, #78) |
| Art v2 | Style research, prompt pack, 16 sheets, P1–P6, style pass, **cart v3** | **done** (#83) |
| **Art v2, remainder** | **Clubhouse and barn v3 Blender pass** | **next. Local only (Blender MCP). See below** |
| 4 | Handling feel and arena zone (#49–#53) | after the clubhouse pass, or in parallel in the cloud |
| 5 | Environment, the rest (#54–#61) | after Stage 4 |
| 6 | navGraph (#62–#64) | — |
| 8, 9, 10 | Economy (#66), refactor (#67), docs (#68) | — |

## Next, part 1: finish this session's work (clubhouse and barn v3, local)

The specs are approved but not built: the "v3 amendments (approved 3 Oct 2026)" sections at the end of `docs/art/specs/clubhouse.md` and `docs/art/specs/team-barn.md`. Targets:
- `docs/concept/reference/clubhouse-hero-01.jpg`, the look
- `clubhouse-breakdown-01.jpg`, the modules
- `hub-kit-01.jpg`, the barn details only. Its gable-end-open barn is **not** the layout.

**Branch:** `clubhouse-v3`, from `main`.

**Pre-flight:**
1. Ask the user to run `uvx mcp-for-blender install-addon`, restart Blender, and Start MCP Server. On 3 Oct the add-on reported protocol 11 against 13; code execution still worked.
2. Confirm Blender has nothing unsaved before opening a file: `bpy.data.is_dirty`. On 3 Oct it had another worktree's `environment.blend` open.

**Steps:**
1. **Prove the kit first.**
   - The clubhouse set is built from scratch by `art/stage7_kit.py` (`build_clubhouse`, `build_team_barn`, `export_all`).
   - Rebuild it unchanged into a scratch file and `diff` the exported `src/entities/graphs/clubhouse.json` against the shipped one. It must be byte-identical before any edit. That proved the exporter for the cart on 3 Oct.
2. **Edit `stage7_kit.py`, not the `.blend` by hand.**
   - **Clubhouse:**
     - `rbox` on the plinth, wall block, cupola base, chimney and cap, 14 posts and 3 steps.
     - 7 `rbox` fascia boards under every roof edge (`cb_trim`).
     - Plain-`box` post bases.
     - Main roof pitch from 17° toward about 25°, ridge about 7.2, with the cupola riding up with it.
     - The weathervane stays cut.
   - **Barn:**
     - `rbox` posts on plain-box bases.
     - 8 `prism` knee braces (`cb_door`).
     - A 0.9 m brick knee wall.
     - An `rbox` `team_trim` fascia.
3. **Budgets** (already raised in `00-pipeline.md`): clubhouse ≤ 4,000 triangles, barn ≤ 900. Raise the bounds in `src/entities/clubhouseGraph.test.ts` to match. That file is the smoke check.
4. **Colliders do not change.** They live in `src/sim/clubhouse.ts` and stop at 6.4 m; the roof was never collidable.
5. **Review:** take viewport screenshots beside `clubhouse-hero-01.jpg`, then an in-game look at High and Med.
6. **Finish:**
   - Run `tsc --noEmit`, the smoke file and `npm test`.
   - Add an "As built" note to both specs.
   - Open a draft PR with a play-test list.
   - STOP.

**Reusable from the cart pass:** `art/cart_v3_kit.py` has `remake()`, which swaps a node's shape in place without orphaning its children. It isn't needed here, because the clubhouse kit builds from scratch.

## Next, part 2: Stage 4, handling feel and arena zone (#49–#53)

The contents are in `REVAMP-PLAN.md` § Stage 4. Branch `stage-4-handling-zone`, from `main`. It can run in the cloud.

- **#51, the camera, now has an art target:**
  - `docs/concept/reference/chase-target-01.jpg` and shot 03 show the cart from lower and slightly to the side, with the seat well and side panel visible.
  - Today `CHASE_HEIGHT` is 3.6 at `CHASE_DISTANCE` 6.5 (`src/render/chaseCamera.ts`), which looks down onto the canopy.
  - `STYLE-RESEARCH.md` P6 suggests about 2.6–3.0 m high at 6–6.5 m back, with the horizon about a fifth of the way down the frame. Tune by feel.
- **#52, the zone, feeds the pickup scatter.** `placePickupSites` already takes an optional `zone` polygon. Pass it from `arenaFromCourse` and `main.ts` together, since both must place the same sites.
- **Sim changes move the Linux golden.** Push, read `expected N to be M` from the failing CI run, record N in a follow-up commit, and say so in both commit messages.

## Then: Stage 5, the rest (#54–#61)

The contents are in `REVAMP-PLAN.md` § Stage 5.

- **Environment target:** `restyle-chase-01.jpg`, which shows:
  - raised bunker lips
  - a clear fairway/rough edge
  - clumps of 3–7 conifers on the rough
  - rolling hills and AO

  Its greyscale (`restyle-chase-grey-01.jpg`) is the value structure to hit: fairway light, rough mid, water dark. **Don't copy its grey water;** keep shot 03's teal.
- **#56 trees:** P1 makes trees smooth. Today `Trees.ts` still sets `flatShading: true` on its instanced material (line 109), and the species have low-segment cones. `treeline.ts` reuses the same geometries. Raise the segments enough to read smooth, and drop the flag.
- **#60 title:** `restyle-chase-golden-01.jpg` is the golden-hour mood.
- **Follow-up after Stage 5 (user, 29 Sep):** push the carts' spawn positions further out. At the clubhouse they start far too close together.

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
- **Blender ↔ Three:** Three (x, y, z) is Blender (x, −z, y), so the cart's front is −Y in Blender. Rotations are X plus at most one of Y or Z. Call `view_layer.update()` before reading matrices.
- **Git hygiene:**
  - Always use `git commit -s`, including on merge commits (`git commit --amend -s --no-edit`).
  - Never put AI-session metadata in git.
  - Never use `git add -A`, because the main checkout carries an untracked `.scratch/` and `tools/zzshots.mjs`.
- **Local worktrees from the art session** (`TeeTimeTurrets-artdir`, `-style`, `-cart3`) and their `style-dev` and `cart3-dev` entries in `../.claude/launch.json` are merged work and safe to remove.
