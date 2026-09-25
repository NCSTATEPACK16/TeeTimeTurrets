# Handoff — next session

Written 2026-09-24. Rewrite this file at the end of each session; it is a baton, not a log.

---

## The direction (set by the user, 2026-09-24 — do not relitigate)

- **Arena is the only mode.** There is no stroke play and no race mode.
- **The match:** a 4v4 team battle (the player and 3 bot allies against 4 bots), lasting **3 minutes**, fought across the continuous 18-hole authored course.
- **Scoring:** reach 0 HP and your team takes a stroke. The team with the fewest strokes wins.
- **Progression:** your individual score earns coins and XP, spent on clubhouse upgrades. A new profile starts with **0 coins**.
- **Clubhouse:** a **landmark in the world** with supplies (ammo bucket, drink = shield, hot dog = health) near it, **and** it stays a menu shop.
- **Spawns:** both teams respawn **at the clubhouse, on opposite sides of it**.
- **Carts should be faster:** "somewhat realistic but a lot of action".
- **The putter becomes a close-range pistol:** fast, flat and accurate.

**The full phased plan** is at `~/.claude/plans/i-want-you-swift-wirth.md` on the user's machine. Its phases and acceptance tests are summarised below.

## Branch and state

- **Branch:** `arena-only`, cut from `origin/main` at `9ff0d01`, which includes PR #27. It has not been pushed and has no PR yet.
- **Commits on the branch:**
  1. `02a505c` — `arenaGolden.test.ts`: a determinism fingerprint of a scripted 40 s arena match on the shipped course. It guards the refactors; its red was proven by nudging `CART_TUNING.accel`.
  2. `7a39942` — Fired balls now roll to a stop and land. There were two bugs:
     - The pool judged landing against hole 1's heightfield.
     - Pooled balls had no rolling resistance, so they rolled forever, never landed, couldn't be picked up and exhausted the pool.
     - `BallPool` now takes a `PoolGround` and applies per-surface drag, with a `MAX_FLIGHT_S` backstop. The golden fingerprint was re-recorded, and the commit says why.
  3. `1eaa8d1` — **Phase 1a/1b of the plan: stroke play removed and the game is arena-only.**
     - `Sim.create(ground: ArenaGround)` (`sim/arena.ts`), with `Sim.dispose()`.
     - The course ball, pin, targets, loadHole/loadCourse, round/session/wallet/scorecard, `ResultsScreen`, the `#match-results` overlay, the pin marker and `devHoleParam` are all gone.
     - `RoundScreen` has become `MatchScreen`.
     - `PlayerIntent` has moved to `sim/intent.ts`.
     - Tests use `arenaFromHole(fixedHoleSpec())` or `sim/testing/miniCourse.ts`.
     - **The golden fingerprint was unchanged by the rewrite**, so the arena plays bit-for-bit as before.
- **Verified at `1eaa8d1`:**
  - `tsc --noEmit` is clean.
  - `npx vitest run --testTimeout=30000` passes: 62 files, 839 tests.
  - `vite build` succeeds.
- **Not run since the rewrite:** `npm run smoke` and `npm run gate`. Both passed at baseline before any change.
- **Leave these alone:** `art/clubhouse-and-cart.blend` has unexplained modifications and `.scratch/` is untracked. Never `git add -A` at the repo root. Use `git commit -s`, and add no AI trailers (see `AGENTS.md`).

## Pick up here, in order

1. **Fix `tools/smoke.mjs` — it will fail as it stands.**
   - It drives the old PLAY → hole path: `__teetimeturrets.session`, `.round`, `#match-results`, `#hud-strokes`, NEXT HOLE, and the per-hole `M` map.
   - Port the drive, aim, fire and ammo checks to PLAY (now the arena → the `match` screen).
   - Delete the hole-advance, scorecard and `#match-results` checks.
   - The dev hook now exposes `sim`, `render`, `coins`, `screen`, `course`, `screens` and `renderer`.
   - The clubhouse check for `6000` coins still holds while `STARTING_COINS` in `main.ts` is 6000; that changes to 0 in Phase 5.
   - Then run `npm run gate`. The `target` subject was removed from both `gateScene.ts` and the baselines.
2. **Finish Phase 1 cleanup:**
   - **Delete the procedural generator.** That means `generateCourse`, `generateHole` and `draftHole` in `course.ts`, all of `courseRelaxation.ts`, and `solveCourseLayout`, `loopRadius` and the lobe constants in `courseLayout.ts`.
     - Keep `boundsOf`, `toHoleFrame`, `inspectLayout` and `fixedHoleSpec`; `fixedHoleSpec` is the test fixture.
     - First move the tests that still use the generator onto `miniCourse`/`authoredCourse`: `courseTerrain`, `courseSurfaces`, `render/courseGround`, `routing`, `course`, `briefs`, and the render tests.
     - Rewrite `tools/feelProbe.ts` as a turret probe. It still calls the deleted `Sim.launch`, and `tsconfig` doesn't cover it, so run `npm run probe` to see the damage.
   - **Add a single `Vec2`/`Vec3` in `sim/vec.ts`.**
   - **Keep par in one place only.**
   - **Import-direction test:** add an assertion to `tools/importCycles.test.mjs` that `sim`/`physics` never import `input`/`ui`/`render`. See it red first.
   - **Left unwired:** `ui/courseMap.ts` (the `M` map, single-hole only) and `render/ground.ts` (still used by the title backdrop). Wire the course-level map in Phase 7; delete `ground.ts` when the backdrop becomes the clubhouse orbit in Phase 6.
   - **The known misplaced bucket** is marked `KNOWN MISPLACEMENT` in `Sim.create`: it sits at hole 1's *local* tee + 10 m. Phase 4 replaces it.
3. **Phase 2:** split `world.ts` (~730 lines now) into `physicsWorld` / `rigs` / `hazardRules` / `respawn` / `shots` / `botDriver` / `pickups` / `snapshot`. `arenaGolden.test.ts` must stay green unchanged. Also fix the discarded buzzer tick, with its own red test.
4. **Phase 3: combat feel and correctness.** Re-record the golden fingerprint where behaviour changes on purpose, and say so in the commit.
   - **Match:** `ARENA_BOTS` 5 → 7 (4v4).
   - **Cart:** `CART_TUNING.topSpeed` 14 → 20, `accel` 16, `steerRate` 2.4.
   - **Putter pistol:** `CLUB_STATS.putter` near-instant charge (~0.08 s), speed 30–38 m/s, loft 2°, spread 0.4°, reload 0.25 s.
   - **Damage per club:** add `damage` to `CLUB_STATS` (the driver does 2).
   - **Ram retune:** `min(2, floor(closing / 6))` damage. It currently one-shots an 8 HP bar; `combat.test.ts`'s shunt test gives its carts 100 HP until then.
   - **Team-aware bot targeting:** today every bot hunts the player (`Sim.botTargetScratch`).
   - **Friend/foe nameplates:** `MatchScreen` marks every bot as an enemy.
   - **Per-cart `Stats[]`.**
   - **Bot aim solver** (`solveShot`). Bot standoff tuning in `bot.ts` assumes the old 9 m/s putter.
   - **`navGraph` bot pathing.**
   - **The halted hazard tie-break spec.**
   - **Loadouts for all rigs,** so paint and skin render in the match.
5. **Phase 4:** the clubhouse colliders and procedural building (`sim/clubhouse.ts`, `render/clubhouse.ts`) at `AUTHORED_CLUBHOUSE` `{x:-243.4, z:-533.3}`, with team spawn pads on opposite sides of it. Pickups follow `docs/superpowers/specs/2026-09-12-stage-d-pickups-design.md`.
6. **Phase 5:** `sim/scoring.ts`, `UPGRADES` data, and `app/profile.ts` (localStorage, starting at 0 coins), plus the results payout and XP.
7. **Phase 6:** dress the course: trees, flagsticks on all 18 greens, tee boxes, cart paths, one parkland sky, and `courseGround` tile eviction.
8. **Phase 7:** kill feed, team strip, course `M` map, synthesised audio, and drawing the preview arc (`Sim.previewTrajectory` already exists).
9. **Phase 8: bring the docs up to date.**
   - **`DECISIONS.md`:** record the arena-only reversal of the "keep stroke play dormant" entry, the clubhouse spawns, the tuning, the economy and audio.
   - **README / `AGENTS.md` overview:** both still describe stroke play and `sim.launch`.
   - **`ROADMAP.md` and `UI-SPEC.md`:** still describe the old modes and screens.
   - **`ARCHITECTURE.md`:** lists modules that no longer exist.
   - **`BACKLOG.md`:** stale rows.

## Traps

- **See every new test fail before trusting it.** This session caught two more green-for-the-wrong-reason tests:
  - A ball rolled uphill reads "at rest" at the top of its climb.
  - Ammo counts are refilled by buckets and landed balls. Measure shots as ammo *decrements*, not as the final count.
- **Timeouts:** `npm test` needs `--testTimeout=30000`. Tests on the authored course carry their own 30–60 s timeouts.
- **Spawns in the one-hole arena:** `arenaFromHole` has two spawn points, the tee facing the cup and the cup facing the tee. Rig 0 is on the tee and rig 1 on the cup. The bucket sits 10 m in front of the tee, so a cart driving forward picks it up.
