# Handoff — next session

Rewritten 2026-09-27, at the end of the local session that closed Stage 1 and built Stage 2. Status updated 2026-09-28 when Stage 2 merged and Stage 7a (art) opened, and 2026-09-29 when Stage 7b (sim) opened as a PR. Rewrite this file at the end of each session: it is a baton, not a log.

---

## Read first

1. `AGENTS.md`: the rules, the Claude of Tanks license note, and the testing policy (as of 1 Oct: one smoke check of 15 s or less per change, every automated check under 60 s, smoke/gate/probe opt-in, and the user play-tests at `?match=60` with items of 60 s or less).
2. **`docs/REVAMP-PLAN.md`: the master stage order and each stage's contents.** It supersedes older plans.
3. `docs/DECISIONS.md`: the two newest sections are the 2026-09-27 revamp and "The golden fingerprint is Linux x64's".
4. `docs/TEST-AND-SPEC-PITFALLS.md` before writing a test or a spec.

## The direction (set by the user; do not relitigate)

- **Arena is the only mode.** Stroke play and race mode are gone.
- **Format:** 4v4 (the player plus 3 bot allies against 4 bots), 3 minutes. Reaching 0 HP costs your team a stroke; the fewest strokes wins.
- **The arena zone is holes 1, 9, 10, 14, 15 and 18** around the clubhouse. It is marked with white stakes, and leaving it drains HP. This lands in Stage 4. Until then the whole course is playable.
- **Friendly fire is off.** Carts are fast, and the putter is a close-range pistol.
- Blender authors primitive-graph JSON only. `art/clubhouse-and-cart.blend` is frozen; the Stage 7 files are `art/cart-v2.blend` and `art/clubhouse-exterior.blend` (the latter built by `art/stage7_kit.py`).
- **Cloud sessions:** work one stage, run the checkpoint, push, update the draft PR, rewrite this file, then **STOP** for the user's play-test. Never merge. Never re-baseline the gate without the user's approval. Never start the next stage without the user saying so.

## Stage 7 (running ahead of Stages 4–6)

- **Where:** worktree `../TeeTimeTurrets-stage7`. The specs are in `docs/art/specs/`.
- **Done:**
  - Stage 7a (art), merged in PR #77: #72 exporter and `prism`, #73 cart v2 (kept after the user's play-test), #74 the clubhouse complex, tee signs and pickup visuals.
  - Stage 7b (sim), branch `stage-7b-sim`, in a draft PR awaiting play-test: #75 colliders and sightlines, #76 pickup collection and the drink shield, the rider rebuilt as `art/rider_kit.py`, and barn bay numbers dropped for good. The "As built, Stage 7b" note in `sim-slices.md` has the details.
- **Known:**
  - The golden fingerprint moved (colliders and pickups change every arena match). Its value is taken from the failing Linux x64 CI run, per `DECISIONS.md`.
  - **Follow-up, after Stage 5 (user, 29 Sep):** push the carts' spawn positions further out; at the clubhouse they start far too close together.

## Where things stand

| # | Stage | Branch | Status |
|---|---|---|---|
| 1 | Finish: 1.8 wiring, 1.9 rematch, checkpoint (#29–#31) | `arena-only`, merged in PR #28 | **done** |
| 2 | Juice and audio (#32–#39) | `stage-2-juice`, merged in PR #69 | **done** |
| 3 | Foundations: performance (#40–#44) and render base (#45–#48) | 3a `stage-3-foundations`, merged in PR #71; 3b `stage-3b-render`, draft PR | 3a **done**; 3b **built, awaiting play-test** |
| 4 | Handling feel and arena zone | `stage-4-handling-zone` | after 3b and Stage 5a art |
| 5 | Environment | `stage-5-environment` | — |
| 6 | navGraph | `stage-6-navgraph` | — |
| 7 | Clubhouse in Blender (**local only**), re-specified in `docs/art/specs/` | `stage-7-blender`, `stage-7b-sim` | **done**: 7a merged in PR #77, 7b in PR #78 |
| 8 | Economy | `stage-8-economy` | — |
| 9 | Refactor | `stage-9-refactor` | — |
| 10 | Docs | `stage-10-docs` | — |

- The milestones "Stage 1" to "Stage 10" each hold that stage's issues (#29–#68, labelled `ready-for-agent`; each lists what blocks it). Close issues from the PR (`Closes #n`).
- **Branching.** Each later stage branches from `main` once the previous PR has merged. If it hasn't merged, branch from the previous stage's branch and say so in the PR.
- **Archived work.** Tag `archive/wonderful-edison` keeps an old branch's `courseTrees.ts` (`cbfedd5`), `courseProps.ts` (`1c49b15`) and clubhouse-in-arena (`cb039b6`) commits. Stages 5 and 7 start from them (see `REVAMP-PLAN.md`). **Do not merge the tag.** Lift files from it with `git show <sha>:<path>`.

### Stage 1 close-out (2026-09-27, after the user's play-test)

- **Gate:** `cart-putter` re-baselined with the user's approval (`ff2832b`).
- **Probe:** now holds the driver to the arena's own reference, 103.8 m total and 75.3 m carry (`74c44f8`). Carry is checked too, because the total alone passed a driver made 20% faster (pitfall #13).
- **Merged:** PR #28 into `main` as `e9fbd21`.

### Stage 2 checkpoint, at `755e34d` (outputs are in PR #69's description)

- `tsc` clean.
- **978 of 979 tests pass on the Mac.** The one failure is the golden fingerprint, which is Linux x64's by design. The Mac's value is unchanged since the pool commit, so no later commit moved the sim.
- **Smoke passes**, including the new controls card, pause and resume checks.
- **Gate passes**, 18 of 18.
- **Probe passes**, 4 of 4.

### Stage 2 close-out (2026-09-28)

- The user play-tested and approved.
- **Merged:** PR #69 into `main` as `8d8365c`. Issues #32–#39 are closed.

## What Stage 2 did

- **#32 `Sim.events`.**
  - One event log for the match: shots, dry pulls, hits, rams, kills, pickups, splashes and respawns.
  - Each reader drains it at its own pace through a cursor. The old per-tick buffer lost every tick's markers but the last whenever a frame ran several ticks.
  - A kill feed reads the log.
- **Ball pool** (the user's decision at the Stage 1 play-test).
  - `BallPool.acquire` falls back in order: idle, oldest landed, oldest ball that has touched down, then, for the player only, the oldest airborne ball that belongs to someone else.
  - Measured: 54 shots, 0 refused, in 60 s of a full 4v4 (before, 25 got off).
  - The golden was re-recorded from CI (`c7fa20a`).
- **#33 Hit feedback.**
  - A damage-direction arc.
  - A low-HP vignette.
  - Real marker values from `sim/scoring.ts` (10 per HP of damage, 100 per kill). Stage 8 builds on those numbers.
- **#34 Effects.**
  - Shards: one `InstancedMesh`, 384 of them, recycled.
  - Splash rings.
  - Dead carts are hidden until they respawn.
- **#35 Camera.**
  - Trauma shake, drawn on top of the smoothed chase pose, never fed back into it.
  - FOV goes from 60 to 69 degrees with speed.
- **#36 Audio.**
  - Synthesised WebAudio; no files ship.
  - Master, SFX and music buses. Music has no content yet.
  - `audioDirector` maps events to cues by distance and bearing.
  - A motor hum, and a heartbeat at low HP.
- **#37 Settings and pause.**
  - Settings live in localStorage inside try/catch and are schema-guarded.
  - Esc pauses, and so does losing the pointer lock mid-match.
  - A controls card appears on first play. GOT IT only dismisses; clicking the canvas takes the lock, as before.
- **#38 The M map is back.** All 18 holes, with team blips.
  - The holes are sampled per hole: 0.5 s, against 3.9 s for sampling the blended course.
  - They are built during PLAY's loading step, so opening the map mid-match does not stall.

## Next session: Stage 5a art, then Stage 4

Stage 3b is built (`render/quality.ts`, `sky.ts`, `shadows.ts`, `post.ts`) and awaits the user's play-test. **Stage 5a art** runs next in `../TeeTimeTurrets-stage5`: rebase `stage-5-art` on main once 3b merges (both touch `render/scene.ts`); horizon is in progress, the course kit is left, and the rider fix is covered by 7b's `art/rider_kit.py`. Then Stage 4, 5, 6, 8, 9, 10.

What 3b leaves for later stages:
- The sky (`PARKLAND_SKY`) is the parkland look for the whole match. Its horizon colour is the fog colour, so anything far away (Stage 5a's horizon hills) should be tinted toward `PARKLAND_SKY.horizon`, not the old `BIOMES.parkland.sky`.
- `QualityPreset.grassDensity`, `treeCap` and `water` are read by nothing yet: Stage 5 reads them.
- High's CSM patches every `MeshStandardMaterial` in the match scene at build time, and ground tiles through `CourseGround.decorateMaterial`. Anything lit that is added to the scene after the constructor must go through `SunShadows.patchMaterial`, or under High it is lit three times over.

For Stage 4, what bears on it:
- **The golden is Linux-only.** A sim change needs its new value from CI: push, read the `expected N to be M` line from the failing CI run, record N in a follow-up commit, and say so in both commit messages.
- **The six-hole zone (#52) feeds the pickup scatter.** `placePickupSites` already takes an optional `zone` polygon; pass it in from `arenaFromCourse` and `main.ts` together, since both must place the same sites.

## Audit findings still open (from 2026-09-26)

- **Performance** (Stage 3):
  - Nameplate line of sight runs up to about 3,500 `heightAt` calls per frame.
  - The heightfield is rebuilt on every PLAY (though no longer on a rematch), and `CourseGround` on every match. `Sim.create` takes about 5 s on the full course in Node.
  - The smoke counts 705 meshes in a match scene (the audit said about 545), and each cart costs about 78 draw calls.
  - Near tiles are never evicted.
  - The sim allocates every tick. That includes Rapier's `translation()`, which the new ammo search calls per landed ball while a bot is empty.
  - DPR is 2 with MSAA.
  - The bundle is one 3.6 MB chunk.
- **Economy bug** (Stage 8): `clubhouseState.ts` rebuilds owned items from the equipped set, so an earlier purchase is lost when you switch items.
- **Paint and skin** never reach the match renderer (Stage 8).
- **Cross-platform sim determinism** (unscheduled): see `DECISIONS.md`, "Open: a sim that computes the same bits everywhere". It is also `RESEARCH-NEEDED.md` item 5, now partly answered by measurement: `Math.sin`/`cos`/`atan2` do differ by architecture, and Rapier's WASM did not across one 40 s match.

## Traps

- **A fresh browser profile opens the first match on the controls card, with the sim frozen.** Any headless tool that plays a match must click GOT IT (smoke does) or pre-seed `localStorage["teetimeturrets.settings"]` with `{"version":1,"seenControls":true}`.
- **Losing the pointer lock mid-match pauses it.** A browser tool that calls `document.exitPointerLock()` during a match is pausing the game, and must press RESUME.
- **See every new test fail before trusting it, and read the red.** This session caught three inert checks by mutation, each green with the thing it guarded removed:
  - The smoke's "a pooled ball is in flight" passed on a bot's ball.
  - "The click that takes the lock does not fire" passed because a full pool refused the shot.
  - "The release after a cancel fires nothing" passed for the same reason, and was dropped.
- **Vitest hides `console.log`** unless you run with `--silent=false --reporter=verbose`.
- **The golden is Linux x64's.** Re-record it only from Linux x64 (cloud sessions and CI are), and in the same commit as the change that moves it.
- **Smoke and the gate in a cloud container:**
  - Chrome renders with SwiftShader, so both scripts wait on sim state or `__gate.ready`, never on `networkidle0` or fixed sleeps.
  - The smoke holds the player at full health until MATCH OVER, because bots kill an idle player within the control checks.
  - `node tools/smoke.mjs` reuses `dist/`. After a mutation experiment, rebuild with `npm run smoke`, or you are testing the mutant.
- **Killing preview servers from Bash:** `ps | grep 'vite preview' | kill` matches the shell running it. Kill by PID in a separate command.
- **`tools/feelProbe.ts` is not type-checked** (it needs Node types that `tsconfig.json` does not load), which is how it rotted unnoticed. Build it with `npm run probe` after any `Sim` API change.
- **Test cart-on-cart and ball-on-cart hits by teleporting once**, never by pinning a kinematic body every tick.
- **Coordinates:** +z is north.
  - The road (`southBoundary`) runs about 30 m south of the clubhouse.
  - `AUTHORED_CLUBHOUSE` is `{x:-241.2, z:-477.3}`.
  - Hole centres are `AUTHORED_PLACEMENTS` in `authoredLayout.ts`.
- **Rough scales cart speed by 0.72,** and most ground near the clubhouse is rough.
- **Git hygiene.**
  - Never put AI-session metadata in commits or PRs.
  - Always use `git commit -s`.
  - Never `git add -A`: the user's local tree has a modified `.blend` and a `.scratch/` folder that must never be committed.
