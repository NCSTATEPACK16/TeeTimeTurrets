# Handoff — next session

Rewritten 2026-10-04, when the clubhouse and barn v3 pass (#85) and the handoff PR (#84) merged at the user's direction. That finishes the art-direction v2 work. Rewrite this file at the end of each session: it is a baton, not a log.

---

**The paste-ready prompt for the next session, Stage 4, is in `docs/NEXT-SESSION-PROMPT.md`.**

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
| Art v2, remainder | Clubhouse and barn v3 Blender pass, plus a detail pass | **done** (#85) |
| **4** | **Handling feel and arena zone (#49–#53)** | **next. See `docs/NEXT-SESSION-PROMPT.md`** |
| 5 | Environment, the rest (#54–#61) | after Stage 4 |
| 6 | navGraph (#62–#64) | — |
| 8, 9, 10 | Economy (#66), refactor (#67), docs (#68) | — |

## Just done: clubhouse and barn v3 (#85, merged 4 Oct 2026)

- **Merged without its own play-test,** at the user's direction. Its hub-look items join the Stage 4 play-test list (see the prompt).

- **Clubhouse:** 4,632 triangles (budget 5,000). It has rbox masses, 7 fascia boards, plain post bases, and the detail pass: ridge and hip caps, window mullions, a double door and cupola louvres. The ridge is 7.35, which makes a 25° pitch. The cupola tip is at 8.55, and the chimney rose with the ridge.
- **Barn:** 1,004 triangles (budget 1,100). It has rbox posts on bases, 8 triangular knee braces, a 0.9 m brick knee wall, an rbox team fascia and a ridge cap.
- **The detail pass came from a 3× A/B test** (a throwaway worktree, now deleted). Only these items read at play distance. Rounder bevels (more `rbox` segments) showed in no shot. Don't spend budget on bevel segments.
- **CI:** `tools/simAllocation.test.mjs` timed out on Node 22. #84's tiering cap is process-wide and ran ahead of the Rapier-reads test. The fix runs that test first.
- The smoke check (`clubhouseGraph.test.ts`) bounds were raised on purpose.
- The "As built, v3" sections of both specs record two deviations from the spec, each with its reason:
  - the braces start 0.8 below the *fascia*, because measured from the eave they hid behind it;
  - the cupola base is 0.2 taller, to close the gap that the steeper slopes opened under it.
- **If a later play-test asks for changes:** edit `art/stage7_kit.py`, then rebuild from a fresh file:
  - `read_homefile(use_empty=True)` in one MCP call;
  - then `exec` both scripts, run `build_all(); export_all(REPO)`, and save `art/clubhouse-exterior.blend`.

## Next: Stage 4, handling feel and arena zone (#49–#53)

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
- **CI runs Node 22; the Mac runs Node 26.** V8-sensitive tests can pass locally and time out on CI. Reproduce with `npx -y node@22 node_modules/vitest/vitest.mjs run <file>`.
