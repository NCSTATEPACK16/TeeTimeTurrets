# Handoff — next session

Written 2026-09-26 (second session). Rewrite this file at the end of each session; it is a baton, not a log.

---

## The direction (set by the user; do not relitigate)

- **Arena is the only mode.** Stroke play and race mode are gone.
- **Format:** 4v4, meaning the player plus 3 bot allies against 4 bots, over 3 minutes on the 18-hole authored course.
- **Scoring:** reaching 0 HP costs your team a stroke, and the fewest strokes wins.
- **Economy:** coins and XP go toward clubhouse upgrades, and a new profile starts at 0 coins.
- **Clubhouse:** a landmark in the world with supplies around it, and also the menu shop. Both teams spawn on opposite sides of it.
- **Feel:** fast carts, and the putter works as a close-range pistol (fast, flat and accurate).
- **Decided 2026-09-26:**
  - Fun first: rules, feel and juice come before refactoring.
  - **Friendly fire is off.**
  - Blender authors **primitive-graph JSON only**, in a **new** `.blend` file.
  - Commit locally and pause at each stage boundary for a user play-test. Do not push.

**The master plan** is at `~/.claude/plans/what-is-next-in-eager-frost.md` on the user's machine. It supersedes the phase order in `i-want-you-swift-wirth.md`. Its stages:

| Stage | Contents |
|---|---|
| 0 | Safety net |
| 1 | Make it a game |
| 2 | Juice and audio |
| 3 | Performance |
| 4 | Clubhouse and pickups (Blender) |
| 5 | Economy |
| 6 | Course dressing |
| 7 | navGraph |
| 8 | Refactor: split `world.ts`, delete the generator |
| 9 | Docs |

## Branch and state

- **Branch `arena-only`** is 13 commits over `origin/main`. It is not pushed and has no PR. The PR is planned for after the Stage 1 checkpoint and the user's play-test.
- **Earlier commits (Stage 0 and 1.1-1.4, 1.6):**
  - `d208c44` Stage 0: smoke on the arena path; the gate dropped the stale `target` subject.
  - `86dd6ec` 1.1: teams; friendly fire off.
  - `9a5488c` 1.2 + 1.3: 4v4 with clubhouse pads.
  - `01590d5` 1.4 + 1.6: faster carts; the ram is capped at 2.
- **This session's commits:**
  1. `45d0331` **1.5 hull.**
     - Each cart has a ball-only cylinder hitbox (`CART_HULL`: r 0.9, 0-2.8 m) on its body, registered as the cart.
     - Collision groups are in `sim/collisionGroups.ts`. The KCC queries with `CART_GROUPS`, so driving is unchanged.
     - A ball damages once per flight (`PooledBall.spent`), and only while `flying`.
  2. `62387bb` **1.5 clubs.**
     - `CLUB_STATS` gains `damage` (driver 2), `gravityScale` (putter 0.4) and `recoil` (m/s at full charge; a blank no longer kicks).
     - Putter: 30-38 m/s, 1 deg loft, 0.08 s charge, 0.25 s reload, 0.4 deg spread. Loft 0 makes the club clip the canopy (`GolfClub.test.ts`).
     - Carts start holding the putter.
     - Bots: `BOT_STANDOFF` 15, `BOT_FIRE_RANGE` 35.
  3. `038cb6d` **1.7 controls.**
     - Mouse0 fires. Mouse2 sets `cancelCharge`, and the trigger must then be let go before it charges again.
     - The camera follows the turret (`render/chaseCamera.ts`), with exponential smoothing in wall-clock frame time.
     - The aim arc is `entities/AimArc.ts`, fed by `previewTrajectory` in `MatchScreen.draw`.
  4. `0db043e` **1.8 bots, part one.**
     - `sim/aimSolver.ts` gives the range -> charge table, and bots release at the solved charge.
     - `computeBotIntent(..., mind: BotMind | null)` handles skill, unstick and ammo seeking, all unit-tested in `bot.test.ts`.
     - **`world.ts` does not pass a mind yet**, so none of that is live in a match.
     - `botAcceptance.test.ts`: an idle player is hit within 30 s on the shipped course.
- **Verified at `0db043e`:**
  - `tsc` is clean.
  - Vitest: 902 tests pass (excluding the uncommitted file below).
  - The golden fingerprint is `1107444919`. It has been re-recorded each commit, deliberately.
  - Smoke and gate have **not** been re-run since Stage 0.
- **Uncommitted: `src/sim/botMind.test.ts`.** Its 2 tests are red and correct, waiting on the wiring below. It is not in git, so do not lose it.
- **Leave alone:** the modified `art/clubhouse-and-cart.blend` and the untracked `.scratch/`. Never `git add -A`.

## Pick up here: finish 1.8 (wire BotMind into world.ts), then 1.9 and the checkpoint

1. **Wire the minds** (`world.ts`), to turn `botMind.test.ts` green:
   - Add `mind: BotMind | null` to `CartRig`. In `addCartRig`, for a bot, the skill is `mulberry32(hashChannel(this.seed, 0, BOT_SKILL_CHANNEL, botIndex))()`. Pass the bot index in, because `rigs.length - 1` is only right after the player's rig is added.
   - In `intentFor`, when `cart.ammo <= 0`, write the nearest ammo into `mind.ammoX/Z/hasAmmoTarget`: an off-cooldown bucket or a `landed` ball. Loop without allocating; do not use `ballsNear`.
   - Pass `rig.mind` to `computeBotIntent`.
   - Then re-record the golden fingerprint and re-run `botAcceptance`.
2. **1.9 rematch correctness:**
   - `Sim.reset` should call `BallPool.releaseAll`, reset the buckets' cooldowns and `simTime`, and reset each mind (`createBotMind` with the same skill, or zero its timers).
   - Fix the discarded buzzer tick. `step()` returns right after `match.tick` sets `over`, so the final tick's movement and contacts never happen. Check what the handoff audit meant before changing it.
3. **Stage 1 checkpoint:**
   - Run `npm run smoke` and the gate. The smoke may need updating for mouse fire and the turret camera. The gate may need a re-baseline, but only with the user's approval.
   - Run `npm run build` and `npm run probe`. The tunneling check applies because ball tuning changed.
   - Then pause for the user's play-test. After it: the PR for Stage 1.

## Audit findings still to act on (from 2026-09-26)

- **Performance** (Stage 3):
  - Nameplate line of sight is up to about 3,500 blended `heightAt` calls per frame (`MatchScreen.ts`, `lineOfSight.ts`).
  - The heightfield is rebuilt on every PLAY, and `CourseGround` on every match.
  - The smoke run counted 545 meshes in the match scene.
  - Carts cost about 78 draw calls each.
  - Near ground tiles are never evicted.
  - Sim per-tick allocations: `cartTransformOf`, `BallPool.ballsNear`'s `.filter`, the `WeakMap` rest ticks, and the closure at `combat.ts` `processContacts`.
  - DPR is 2 with MSAA.
  - The bundle is one 3.6 MB chunk.
- **Economy bug:** `clubhouseState.ts` rebuilds owned items from the equipped set, so an earlier purchase is lost when you switch.
- **Paint and skin** never reach the match renderer.
- **Hit markers** show a fake "+50".

## Traps

- **See every new test fail before trusting it, and read the red.** This session: a test that set `cart.turretYaw` threw on a getter-only property, which is a red for the wrong reason, so fix the test until the red is the real one.
- **Vitest hides `console.log`** unless you run with `--silent=false --reporter=verbose`.
- Tests need `--testTimeout=30000`. The golden test times out at the 5 s default.
- **Test cart-on-cart and ball-on-cart hits by teleporting once, never by pinning a kinematic body every tick.** Pinning each tick doesn't reliably generate started contacts.
- **Coordinates:** +z is north. The road (`southBoundary`) runs about 30 m south of the clubhouse. `AUTHORED_CLUBHOUSE` is `{x:-241.2, z:-477.3}`; the old handoff's `-243.4/-533.3` is stale.
- **Rough** scales cart speed by 0.72, and most ground near the clubhouse is rough.
- **Never put AI-session metadata in commits.** Always use `git commit -s`.
