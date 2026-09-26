# Handoff — next session

Written 2026-09-26. Rewrite this file at the end of each session; it is a baton, not a log.

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

- **Branch `arena-only`** is 8 commits over `origin/main`. It is not pushed and has no PR.
- **Commits this session:**
  1. `d208c44` **Stage 0.** `tools/smoke.mjs` is ported to the arena path. The gate runner dropped the stale `target` subject.
     - Smoke: 52 checks, all PASS.
     - Gate: 18 subjects, all PASS with no re-baseline.
  2. `86dd6ec` **Stage 1.1, teams.**
     - `bot.ts` has a new `pickTarget`: nearest living enemy by `teamOf`, with a 15 m switch margin, and `NO_TARGET` when none is left.
     - `CartRig.targetIndex` holds each bot's target.
     - `combat.ts` skips damage from a teammate's or the cart's own ball, and skips damage when teammates ram. Teammates still get shoved apart.
     - `plateTeamOf` in `ui/plateState.ts` gives ally/enemy nameplates. Allies skip the line-of-sight walk.
  3. `9a5488c` **Stage 1.2 + 1.3.**
     - `ARENA_BOTS` = 7, so the match is 4v4.
     - `ArenaGround.clubhouse` is set by `arenaFromCourse` to `AUTHORED_CLUBHOUSE`. `miniCourse` and `arenaFromHole` pass `null` and still deal carts onto the tees.
     - `spawn.ts` has `createTeamPads` and `padSpawn`:
       - team 0's pad is 25 m west of the clubhouse and team 1's 25 m east;
       - each pad has 4 slots, 7 m apart, running north;
       - carts face north.
     - `Cart.revive()` tops ammo up to `STARTING_AMMO`.
  4. `01590d5` **Stage 1.4 + 1.6.**
     - `CART_TUNING`: topSpeed 20, accel 16, brake 24, reverse 7, steerRate 2.4, steerFullSpeed 8.
     - Ram damage is now `min(RAM_MAX_DAMAGE=2, floor(closing/6))`. The rammer (more than 1 m/s more approach speed) takes half. A head-on is mutual.
     - A 90 s probe with 8 carts across the whole course never put a cart under the ground.
- **Verified at `01590d5`:**
  - `tsc` is clean.
  - `npx vitest run --testTimeout=30000` passes: 63 files, 864 tests.
  - The golden fingerprint was re-recorded 3 times, each deliberately, with the reason in the commit message. It is now `2167757381`.
  - Smoke and gate were **not** re-run after Stage 1.1; run them at the Stage 1 checkpoint.
- **Leave alone:**
  - `art/clubhouse-and-cart.blend` (unexplained modifications).
  - `.scratch/` (untracked).
  - Never `git add -A`.

## Pick up here: Stage 1.5, weapons (in progress, nothing written yet)

**The blocker found:** the muzzle is at `TURRET_GEOMETRY.pivotHeight` 2.6 m, but the cart's only collider is a capsule topping out at 1.9 m (`CART_COLLIDER`: radius 0.6, halfHeight 0.35). A flat, fast putter shot flies over any nearby cart, and with real gravity a 40 m "pistol" shot drops about 7 m. The planned fix:

1. **Hull hitbox.** Add a ball-only cylinder collider per cart: radius about 0.9, from the ground to about 2.8 m. Its local y offset is `1.4 - CART_COLLIDER.groundOffset`. Register it in `CombatRegistry` as the same cart and index.
   - Use collision groups so only balls touch it:
     - BALL membership bit;
     - HULL membership bit with filter = BALL;
     - the capsule's filter excludes HULL.
   - Pass the capsule's groups as `filterGroups` to `controller.computeColliderMovement` (`world.ts`, `moveCartBody`), so KCC queries ignore hulls. Verify that Rapier 0.20 does not already exclude same-body colliders.
   - A cylinder rather than a box, because cart bodies aren't rotated with heading.
   - Guard against double hits: add `spent` to `PooledBall` (reset in `beginFlight`). A ball damages only while `state === "flying" && !spent`, and is marked spent when it deals damage. This also stops a slowly rolling ball from doing full damage.
   - **Red test first:** fire the player's putter at a bot 4 m away on `arenaFromHole(fixedHoleSpec())`. The ball passes about 2.2 m up and misses the capsule today. Teleport the bot once, never every tick (see Traps).
2. **Club retune** (`CLUB_STATS`, `Ballistics.ts`):
   - Add per-club fields:
     - `damage`: putter 1, iron 1, driver 2. `combat.ts` must use it instead of `STROKE_DAMAGE`.
     - `gravityScale`: the putter around 0.3 for a flat pistol line. Apply it with `body.setGravityScale` in `resolveShot`, **and** mirror it in `Sim.previewTrajectory`.
     - `recoil`: the m/s kick at full charge, replacing the `recoilCoefficient × launch speed` rule, so a putter burst doesn't skate the cart. A blank (no-ammo) shot gives no kick.
   - Putter: charge about 0.08 s, 30–38 m/s, loft about 0–2°, spread 0.4°, reload 0.25 s.
   - Iron: 0.7 s charge.
   - Carts spawn holding the putter. `world.ts` builds the player's cart with no club, so the driver is the default.
   - Test with a pure flight helper that mirrors `previewTrajectory`'s integration: the putter reaches 40 m in under 1.3 s and is still above the ground inside the hull height.
   - Then retune the bot constants in `bot.ts`, which assume a 9 m/s putter: `BOT_STANDOFF` 7, `BOT_FIRE_RANGE` 9, `BOT_CHARGE_RELEASE`. `arenaCombat.test.ts` depends on them.
3. **Then the rest of Stage 1:**
   - 1.7 controls: left mouse to charge and fire, right-click `cancelCharge`, the camera follows turret yaw with time-based smoothing, and the preview arc is drawn from `Sim.previewTrajectory`.
   - 1.8 bots:
     - `solveShot` from a range table;
     - seek ammo when empty;
     - unstick after 2 s without progress;
     - seeded skill;
     - acceptance: at least one hit within 30 s on an idle player on the shipped course.
   - 1.9 rematch correctness: `Sim.reset` calls `BallPool.releaseAll` and resets buckets and `simTime`; fix the discarded buzzer tick.
   - **Then the Stage 1 checkpoint:** smoke, gate, build, and pause for the user to play-test.

**Blender (Stage 4)** needs the user to start Blender with the MCP addon; it wasn't connected this session.

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
