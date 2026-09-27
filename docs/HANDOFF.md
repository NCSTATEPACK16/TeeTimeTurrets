# Handoff — next session

Rewritten 2026-09-27, when this project moved to cloud sessions. Rewrite this file at the end of each session: it is a baton, not a log.

---

## Read first

1. `AGENTS.md`: the rules, the Claude of Tanks license note, and the "see red first" testing rule.
2. **`docs/REVAMP-PLAN.md`: the master stage order and each stage's contents.** It supersedes older plans.
3. `docs/DECISIONS.md`: the newest section is the 2026-09-27 revamp.
4. `docs/TEST-AND-SPEC-PITFALLS.md` before writing a test or a spec.

## The direction (set by the user; do not relitigate)

- **Arena is the only mode.** Stroke play and race mode are gone.
- **Format:** 4v4 (the player plus 3 bot allies against 4 bots), 3 minutes. Reaching 0 HP costs your team a stroke; the fewest strokes wins.
- **The arena zone is holes 1, 9, 10, 14, 15 and 18** around the clubhouse. It is marked with white stakes, and leaving it drains HP. This lands in Stage 4. Until then the whole course is playable.
- **Friendly fire is off.** Carts are fast, and the putter is a close-range pistol.
- Blender authors primitive-graph JSON only, in a **new** `.blend`. Never touch `art/clubhouse-and-cart.blend`.
- **Cloud sessions:** work one stage, run the checkpoint, push, update the draft PR, rewrite this file, then **STOP** for the user's play-test. Never merge. Never re-baseline the gate without the user's approval. Never start the next stage without the user saying so.

## Stages and GitHub

The milestones "Stage 1" to "Stage 10" each hold that stage's issues. Close issues from the PR (`Closes #n`).

| # | Stage | Branch | Status |
|---|---|---|---|
| 1 | Finish: 1.8 wiring, 1.9 rematch, checkpoint | `arena-only` (draft PR → `main`) | **in progress** |
| 2 | Juice and audio | `stage-2-juice` | — |
| 3 | Foundations: performance and render base | `stage-3-foundations` | — |
| 4 | Handling feel and arena zone | `stage-4-handling-zone` | — |
| 5 | Environment | `stage-5-environment` | — |
| 6 | navGraph | `stage-6-navgraph` | — |
| 7 | Clubhouse in Blender (**local only**) | `stage-7-clubhouse` | — |
| 8 | Economy | `stage-8-economy` | — |
| 9 | Refactor | `stage-9-refactor` | — |
| 10 | Docs | `stage-10-docs` | — |

- **Branching.** Each later stage branches from `main` once the previous PR has merged. If it hasn't merged, branch from the previous stage's branch and say so in the PR.
- **Archived work.** Tag `archive/wonderful-edison` keeps an old branch's `courseTrees.ts` (`cbfedd5`), `courseProps.ts` (`1c49b15`) and clubhouse-in-arena (`cb039b6`) commits. Stages 5 and 7 start from them (see `REVAMP-PLAN.md`). **Do not merge the tag.** It was built on pre-arena-only code; lift files from it with `git show <sha>:<path>`.

## Pick up here: Stage 1 on `arena-only`

**State at `5b85025` and after:**
- `tsc` is clean.
- Vitest: 902 tests pass, plus **2 red on purpose in `src/sim/botMind.test.ts`**. Those two are the spec for 1.8. CI stays red until they pass.
- The golden fingerprint is `1107444919`. It is re-recorded deliberately whenever the sim changes.
- Smoke and the gate have not been run since Stage 0.

**Steps:**
1. **1.8 Wire the minds** (`src/sim/world.ts`) to turn `botMind.test.ts` green.
   - Add `mind: BotMind | null` to `CartRig`.
   - In `addCartRig`, for a bot, set the skill to `mulberry32(hashChannel(this.seed, 0, BOT_SKILL_CHANNEL, botIndex))()`. Pass the bot index in, because `rigs.length - 1` is only right after the player's rig has been added.
   - In `intentFor`, when `cart.ammo <= 0`, write the nearest ammo into `mind.ammoX/Z/hasAmmoTarget`. That is an off-cooldown bucket or a `landed` ball. Loop without allocating, and do not use `ballsNear`.
   - Pass `rig.mind` to `computeBotIntent`.
   - Then re-record the golden and re-run `botAcceptance.test.ts`.
2. **1.9 Rematch.**
   - `Sim.reset` should call `BallPool.releaseAll`, reset the bucket cooldowns and `simTime`, and reset each mind (`createBotMind` with the same skill).
   - Fix the discarded buzzer tick. `step()` returns right after `match.tick` sets `over`, so the final tick's movement and contacts never happen. Write a failing test first.
3. **Checkpoint.**
   - Run `npm run smoke`. Update `tools/smoke.mjs` for mouse fire and the turret camera if it needs it.
   - Run `npm run build`, which includes the gate. Propose any re-baseline in the PR and do not commit it.
   - Run `npm run probe`. The tunneling check applies, since ball tuning changed in 1.5.
   - Paste the outputs into the PR, rewrite this file, push, and STOP.

**What Stage 1 already did** (the commits are on `arena-only`):
- **1.1 Teams.** Friendly fire is off.
- **1.2 and 1.3.** 4v4 with clubhouse spawn pads.
- **1.4 and 1.6.** Faster carts; the ram is capped at 2.
- **1.5 Ball-only hull hitbox.** `CART_HULL` is a cylinder, r 0.9, 0–2.8 m.
- **1.5 Putter pistol.** `CLUB_STATS` gains `damage`, `gravityScale` and `recoil`. The putter fires at 30–38 m/s with 1° loft.
- **1.7 Controls.** Mouse0 fires. Mouse2 cancels, and the trigger must be let go before it charges again. The camera follows the turret. The aim arc is `entities/AimArc.ts`.
- **1.8, first half.**
  - `sim/aimSolver.ts` holds the range → charge table.
  - `computeBotIntent(..., mind)` handles skill, getting unstuck and ammo seeking.
  - `botAcceptance.test.ts` checks that an idle player is hit within 30 s.

## New in the repo for the revamp

- **`src/vendor/cot/`.** MIT code from Claude of Tanks: `terrainMobility.ts` (Stage 4), `botRoutePlanner.ts` (Stage 6) and `shadowStability.ts` (Stage 3). Each has a `NOTICE` entry. They are DOM-free, so `src/sim/**` may import them.
- **`reference/claude-of-tanks/*.ts.txt`.** MIT engine files: sky, lighting, quality, cameraRig and post. They are reading material only and not compiled. Adapt them in small pieces, and add a `NOTICE` entry for anything that lands in `src/`.
- **`public/textures/terrain/`.** Five CC0 PBR sets, used in Stage 5 (see `LICENSES.md`).
- **The Claude of Tanks repo itself is not available to cloud sessions, and nothing more may be taken from it.** Its world and vehicle code is proprietary. `REVAMP-PLAN.md` describes the techniques by name, so write them from scratch.

## Audit findings still open (from 2026-09-26)

- **Performance** (Stage 3):
  - Nameplate line of sight runs up to about 3,500 `heightAt` calls per frame.
  - The heightfield is rebuilt on every PLAY, and `CourseGround` on every match.
  - A match has about 545 meshes, and each cart costs about 78 draw calls.
  - Near tiles are never evicted.
  - The sim allocates every tick.
  - DPR is 2 with MSAA.
  - The bundle is one 3.6 MB chunk.
- **Economy bug** (Stage 8): `clubhouseState.ts` rebuilds owned items from the equipped set, so an earlier purchase is lost when you switch items.
- **Paint and skin** never reach the match renderer (Stage 8).
- **Hit markers** show a fake "+50" (Stage 2).

## Traps

- **See every new test fail before trusting it, and read the red.** A red for the wrong reason (a throw in setup, say) is not the red you want.
- **Vitest hides `console.log`** unless you run with `--silent=false --reporter=verbose`.
- **Tests need `--testTimeout=30000`.** The golden test times out at the 5 s default.
- **Test cart-on-cart and ball-on-cart hits by teleporting once**, never by pinning a kinematic body every tick.
- **Coordinates:** +z is north.
  - The road (`southBoundary`) runs about 30 m south of the clubhouse.
  - `AUTHORED_CLUBHOUSE` is `{x:-241.2, z:-477.3}`.
  - Hole centres are `AUTHORED_PLACEMENTS` in `authoredLayout.ts`.
- **Rough scales cart speed by 0.72,** and most ground near the clubhouse is rough.
- **Git hygiene.** Never put AI-session metadata in commits or PRs. Always use `git commit -s`. Never `git add -A`: the user's local tree has a modified `.blend` and a `.scratch/` folder that must never be committed.
