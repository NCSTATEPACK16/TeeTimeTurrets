# Stage 3.5c, the Mulligan Mortar and capture flags: Implementation Plan

**Goal:**
- Capture flags A, B and C on the greens of holes 14, 10 and 9. A side that holds two or more
  makes the other side bleed a stroke every 20 s.
- A Mulligan Mortar, earned at 3 kills in a streak: a telegraphed, seeded barrage of six balls.
- Bots that take flags and call mortars.

**Spec:** `docs/superpowers/specs/2026-11-27-mortar-and-capture-flags-design.md`. Its numbers,
rules and section numbers are the user's (answered 27 Nov, every default). Ask only if the code
contradicts it.

**State:** written 27 Nov 2026 from a read of `main` at `014c52c`. Nothing is built.

## Global constraints

- **Three slices, three PRs.** Each is merged before the next starts (`DECISIONS.md`, 7 Nov
  follow-up). Each ends at a play-test stop with items of 60 s or less at `?match=60`.
- **`src/sim/**` stays DOM-free, Rapier-free where it is today, and allocation-free per tick.**
  `tools/simAllocation.test.mjs` is the check. Every new per-tick structure is a fixed typed array
  or a fixed slot array made once, as `Match` and `SimEventLog` are.
- **No `Math.random`, and no `hashChannel` per tick:** it allocates through its rest parameter.
  Build streams once (`mulberry32(hashChannel(seed, CHANNEL))`), as `Sim.spawnRandom` is.
- **The golden** (`src/sim/arenaGolden.test.ts`) must not move in slices 1 and 2. Slice 3 moves it
  once, recorded from Linux x64 (`DECISIONS.md`, "The golden fingerprint is Linux x64's").
- **The 60 s cap.** Root `npm test` was 57.7 s on #98. **Every slice starts with Task 0.**
- **Checks describe behaviour, not code** (`TEST-AND-SPEC-PITFALLS.md` §2). Each check below
  names the failure it must catch. See each one red with that failure before it goes green, and
  keep the output for the PR.
- Commits: `git commit -s`, no AI or session metadata, files staged by name.

## Task 0 (every slice): make room under the cap

1. Run `npx vitest run --reporter=verbose 2>&1 | tee` in a scratch file. Sort the files by
   duration.
2. Trim the slowest file by at least the new check's cost plus 2 s. Fewer ticks, a single-hole
   arena instead of the course, or a shared `beforeAll` world. Do not delete a case that guards a
   listed pitfall.
3. Say in the PR what was trimmed and the before and after times.

---

## Slice 1: the flags

### Task 1.1: the sites

- `src/sim/arena.ts`:
  - `export const CAPTURE_HOLE_INDICES = [13, 9, 8]` (A, B, C), with the spec §1 table in its doc
    comment.
  - `captureSites(world: CourseWorld): Vec2[]` turns each cup into the course frame with
    `toCourseFrame` (`src/sim/courseGeometry.ts`), the same way the spec's table was measured.
  - `ArenaGround` gains `readonly captureSites: readonly Vec2[]`. `arenaFromCourse` fills it, and
    `arenaFromHole` gets `[]`.
- `main.ts` (or wherever it builds the arena) reads the same list for the renderer, as it does
  `coursePickupSites`.

### Task 1.2: `src/sim/flags.ts`

- `CaptureField`, as spec §2.2–2.4 gives it: `owner` (`Int8Array`), `progress`
  (`Float64Array`), `contested` (`Uint8Array`), and `bleedIn`.
- Constants: `CAPTURE_RADIUS_M = 12`, `CAPTURE_TIME_S = 6`, `CAPTURE_MAX_CARTS = 3` and
  `FLAG_BLEED_INTERVAL_S = 20`.
- `tick(dt, carts, match, events, tickCount)` counts the living carts of each team per flag in one
  loop, applies the rules, and pushes `flagCaptured`, `flagNeutral` and `flagBleed`.
- A leaf like `match.ts`. It imports `matchConfig`, `match` and `events` types only. Run
  `tools/importCycles.test.mjs`.

### Task 1.3: the score

- `src/sim/match.ts`:
  - `private readonly bleed = new Int32Array(TEAM_COUNT)`, `bleedFor(team)` and `addBleed(team)`.
  - `teamStrokes` adds `bleed[team]`.
  - `reset` zeroes `bleed`.
  - Update the file's header comment: a team's strokes are now deaths plus bleed.
- `strokesFor`, `pointsFor` and `scoreKill` are unchanged.

### Task 1.4: wiring in `Sim`

- `src/sim/world.ts`:
  - It builds a `CaptureField` from `ground.captureSites`.
  - In `step`, the field ticks **after** `processContacts`, and only when the tick was live
    (`!counting`), so a cart killed this tick does not hold a flag. Ticking after
    `Match.tick` means the tick that ends the match does not bleed: a partial interval at the
    buzzer bleeds nothing.
  - Expose it read-only as `sim.captures`.
  - `reset` calls `captures.reset()`.
- `src/sim/events.ts`: the three kinds, with the field meanings from spec §2.5 in the kind list's
  comment.

### Task 1.5: what the player sees and hears

- **H14:**
  - `src/ui/hudState.ts` gains, per flag, an owner, the progress and a contested flag, plus the
    bleed countdown text. It writes into the existing scratch, with no allocation.
  - `src/ui/hud.ts` draws three chips under `teamScore`. **The markup ships the chips empty**, so
    only code can fill them (pitfalls §1, instances 5 and 6).
- **H18:** a `Flagstick` (`src/entities/Flagstick.ts`) per capture site, cloth in
  `src/render/teamColors.ts` colours, plus a ring decal.
  - `placeFlagstick` takes a single-hole `Terrain`. Place these with `sim.heightAt` instead.
  - Each one is disposed with the match (`AGENTS.md` resource cleanup).
- **H8:** `MapMarker.kind` gains `"flag"`, pushed in `MatchScreen` beside the `"pickup"` markers.
  Give it a fill in `MARKER_FILL`.
- **Results:** `deriveScoreboard` (`src/ui/matchScoreboard.ts`) gains a `FLAGS +n` line per
  side.
- **Banners:** in `MatchScreen`'s event loop, pushed through `BannerFeed.push`, with the wording
  from spec §5.
- **Audio:** `cueFor` (`src/audio/audioDirector.ts`) gets cases for the three kinds. Capture and
  loss stings, and a bleed tick.
- **UI-SPEC §2:** update H14, and add the H18 and H8 changes.

### Task 1.6: smoke check, `src/sim/flags.test.ts` (pure, under 1 s)

It must be seen to fail for each of these, each with its own discriminable red:

- With one cart, capture lands on tick 360 (6 s), not 359 and not 361. With three carts it lands
  on tick 120. Four carts are no faster than three.
- A contested flag's progress is bit-identical before and after 300 ticks.
- An enemy-owned flag raises `flagNeutral` before `flagCaptured`, and is never owned by both.
- Holding two flags bleeds on tick 1200 exactly. Dropping to one at tick 1100 and retaking at 1150
  bleeds at 1150 + 1200, not at 1200.
- `teamStrokes` is deaths plus bleed, **as an exact sum** (pitfalls §1, instance 8), and
  `winningTeam` changes sides on bleed alone.
- On the shipped course, each of the three `captureSites` is inside `courseArenaZone` and
  `surfaceAt` reads `Green`. Seen red with `CAPTURE_HOLE_INDICES` off by one.

Then run `npx vitest run src/sim/arenaGolden.test.ts tools/simAllocation.test.mjs`. **The golden
does not move.** If it does, stop.

### Play-test stop 1

At `?match=60`:
- you can tell whose flag is whose from the HUD, the map and the green;
- taking one feels like the right length;
- the bleed reads as a consequence and not as noise.

Then play three `?match=180` matches and write each side's deaths and bleed strokes in the PR. The
user judges from those whether kills still count for more.

---

## Slice 2: the mortar, for the player

### Task 2.1: earning it

- `src/sim/entities/Cart.ts` gains `killStreak` and `mortars`. `revive` keeps `mortars` (Q6),
  and `rearm`/reset clear both.
- `Sim.killCart`:
  - An enemy kill adds one to the killer's `killStreak`, under the same rule `Match.scoreKill`
    awards a point by.
  - At every multiple of 3, if `mortars` is 0, it sets 1 and pushes `mortarEarned`.
  - The victim's streak goes to 0, whatever killed it.
- `MatchScreen` shows `ON THE GREEN / MORTAR READY [G]` when a `mortarEarned` for rig 0 arrives
  on the same tick as the kill's streak callout. `StreakTracker` keeps the headline.

### Task 2.2: calling it

- `src/sim/intent.ts`: `callMortar: boolean`, false in `neutralIntent()`. `holdIntent`
  (`world.ts`) leaves it false.
- `src/input/mapping.ts`: `KeyG` sets it on the press edge. Add `KeyG` to `SWALLOWED` in
  `KeyboardMouseSource.ts`. Add a row for it in the controls list beside "Honk the horn".
  `mapping.test.ts` gets the case.
- In `Sim.stepRig`, on `callMortar` with `mortars === 1`:
  - Compute the target with `previewTrajectory(1, cart.turretYaw, this.mortarArc)`, using a
    private `Vec3[]` of `PREVIEW_MAX_POINTS` made once. The arc's last point is the landing.
  - Cap it at `MORTAR_MAX_RANGE_M = 160` and clamp it with `zone.clampInside`.
  - Take a free barrage slot, or refuse and keep the mortar.
  - Draw the six offsets now, from `mortarRandom`.
  - Set `mortars = 0` and push `mortarCalled`.
  - Bots never set `callMortar` in this slice.

### Task 2.3: the barrage

- A new `src/sim/mortar.ts` holds the constants from spec §3.3–3.4 and the `Barrage` slot type:
  owner, six impact points, call tick, balls spawned. `MAX_BARRAGES = 4` slots on `Sim`, made
  once.
- `mortarRandom = mulberry32(hashChannel(seed, MORTAR_CHANNEL))` with `MORTAR_CHANNEL = 6`.
  Build it in the constructor and in `reset`, beside `spawnRandom`. Put the channel next to the
  others' table in a comment.
- In `stepCarts`, after `ballPool.step`, each live slot spawns any ball whose spawn tick has
  come.
  - The ball is impact time minus the computed drop time, from height 40 and speed 20 m/s at
    gravity 1.
  - It comes from `ballPool.acquire(owner, true)`, with `pooled.damage = 2` and
    `pooled.mortar = true`.
  - A null acquire skips that ball.
- `PooledBall.mortar`: set in `beginFlight` from a parameter, and cleared in `release`.
- **Splash:**
  - `BallPool.step` already flips `touchedDown`. It records the index of a mortar ball that
    touched down this tick in a fixed `Int32Array`, plus a count.
  - After `processContacts`, `world.ts` applies 1 damage to each enemy cart within 3 m of that
    ball: living, not protected, not the cart it hit, and a shield plate absorbs it.
    `onCartKilled` credits the kill to the owner.
  - Reuse `combat.ts`'s `sameSide` rule. Export it rather than copy it.

### Task 2.4: what the player sees and hears

- **H19:** the `MORTAR [G]` chip beside the ammo card. Hidden when none is held, and the markup
  ships hidden.
- **H20:** the red ring decal at the target, filling over 2 s, plus a positional whistle. In the
  render layer, from `mortarCalled`.
- **H8:** a `"mortar"` marker for 3 s.
- **H12:** `INCOMING! / MOVE` once, when the player's cart is inside the ring at any point before
  the last ball.
- **Audio:** `cueFor` cases for `mortarEarned` (the player's only) and `mortarCalled`
  (positional).
- **UI-SPEC §2:** add H19 and H20.

### Task 2.5: smoke check, `src/sim/mortar.test.ts` (single-hole arena `Sim`, under 10 s)

It must be seen to fail for each of these:

- The mortar is earned on the 3rd kill and not the 2nd. A death between kill 2 and kill 3 means
  no mortar at kill 3. A held one survives a death.
- After a call, six balls are spawned, and each one's first touchdown is within 8 m of the target.
  The first lands no earlier than tick call + 120.
- Two `Sim`s from one seed produce the same six impact points, bit for bit. A different seed
  produces different points.
- A cart killed by a mortar ball scores a point for the caller (`pointsFor`).
- Splash is blocked by friendly fire, by spawn protection, and by a shield plate. Each is its own
  case, seen red with its guard removed.

Then the golden and allocation checks. **The golden does not move.**

### Play-test stop 2

At `?match=60`:
- earning a mortar is noticed;
- the ring gives enough warning to escape at speed, and not enough when parked;
- the barrage looks goofy and kills a parked cart.

---

## Slice 3: bots, and the golden

### Task 3.1: flag running

- In `world.ts`, rig 1 (team 1) and rig 2 (team 0) are runners, by index.
- In `botTargetScratch`, a runner with no enemy within `BOT_ENGAGE_RANGE` drives at the nearest
  flag its team does not own. If its team owns all three, it drives to the owned flag with the most
  enemies nearest it.
- Any other bot whose target is over `BOT_FLAG_DIVERT_M = 120` away drives at the nearest flag its
  team does not own.
- Both write `driveX/driveZ` only. `computeBotIntent`'s priority order (unstick, ammo, heal, then
  drive) is unchanged. Defending stays off (Q10).

### Task 3.2: bot mortars

- In `src/sim/bot.ts`, `shouldCallMortar(bot, target, allyNearTarget)` is pure and draws no RNG.
  It follows the conditions in spec §3.5.
- `world.ts` sets the intent's `callMortar`. A bot's target point is its target's position now,
  not the arc.

### Task 3.3: smoke check (one case in `src/sim/world.course.test.ts`, under 15 s)

- It takes its carts from the shipped course. It **asserts the premise first**: rig 2 starts more
  than 100 m from every capture site.
- Then rig 2 is inside a site's radius within 1,800 ticks.
- Seen red with the runner rule disabled.
- If this file is the slowest, Task 0 trims it first.

### Task 3.4: the golden, once

- In `arenaGolden.test.ts`'s `playScript`, add `sim.match.teamStrokes(0)` and `(1)` after the
  per-player loop.
- Re-record from Linux x64 in a cloud session, in one commit whose message says why: bots now drive
  at flags and call mortars, and team strokes are hashed.
- Run the golden and allocation checks before and after, and paste both into the PR.

### Play-test stop 3

At `?match=60`:
- bots take flags without being told to;
- they don't get stuck on the way to B;
- a bot's mortar is escapable;
- a match still feels like a fight, not a relay race.

---

## Done when

All three PRs are merged, and `SPEC-QUEUE.md`, `HANDOFF.md` and `NEXT-SESSION-PROMPT.md` say
3.5c is built. Stage 4b (prompt C) is next.
