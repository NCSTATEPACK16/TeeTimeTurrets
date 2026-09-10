# Arena mode: the match itself — implementation plan

Against `docs/superpowers/specs/2026-09-09-arena-match-and-scoring-design.md`. Decisions are
cited as D1–D13 from that file.

**This plan deliberately carries no test bodies.** `docs/TEST-AND-SPEC-PITFALLS.md` §2 records
what happened the last time a plan did: three of the nine recorded wrong-reason tests were
brief-verbatim, and so was a duplicated best-bot loop under a comment claiming there was only
one. Each task below states **the behaviour, the exact values, and the failure the test must be
able to detect**. Write the assertion yourself, and before you do, ask what else would satisfy
it.

**Non-negotiable per task:** see every new test red first, and keep the output. Where the code
came first — which is every rot guard here — mutate the finished module and watch the test fail.
A test that has only ever been green is a claim.

---

## C1 — the scoreboard

### Task 1.1 — `src/sim/matchConfig.ts`

Every arena tunable in one module, nothing else in it. `MATCH_DURATION_S` moves here from
`world.ts` and is re-exported from `world.ts` so nothing breaks.

`MAX_PLAYERS = 24`, `TEAM_COUNT = 2`, `ARENA_MAX_HEALTH = 8`, `SPAWN_PROTECTION_S = 3`,
`SPAWN_CLEARANCE_M = 60`, `SPAWN_TRIES = 8`, `NO_KILLER = -1`, and `teamOf(index)`.

The module's docstring says these are **playtest placeholders**, not derived constants — that is
the user's stated position and it needs to be visible at the values rather than in a session log.
`RESPAWN_DELAY_S` stays on `Cart.ts`: it is shared with stroke play and moving it would give it
two homes.

**Import direction:** nothing in `matchConfig.ts` may import from `world.ts`, `course.ts` or
`surfaces.ts`. `tools/importCycles.test.mjs` fails the suite on a value-import cycle in `src/**`
and this is a leaf by construction (pitfall §6).

**Test:** `teamOf` splits any roster within one. Assert for 1, 2, 3, 24 players that the two
team sizes differ by at most one **and that team 0 contains index 0**. The failure to detect: a
`< n/2` split, which is even at 24 and puts a 3-player match 2–1 with the player possibly on the
larger side.

### Task 1.2 — `src/sim/match.ts`

`Match` owns the clock (D2) and the scoreboard (D1, D3).

Construction takes `{ playerCount, durationS }`. Fields: `remaining`, `over`, `durationS`;
`points` and `strokes` as `Int32Array(MAX_PLAYERS)` allocated once (D3), never resized.

- `tick(dt)` — counts down; sets `over` on the tick that brings `remaining` to zero. The
  half-tick threshold currently in `Sim.step` moves here **verbatim, with its comment**: repeated
  subtraction of 1/60 leaves a float residue and an exact `<= 0` never fires.
- `scoreKill(killer, victim)` — `strokes[victim] += 1` always; `points[killer] += 1` only when
  `killer !== NO_KILLER` and `teamOf(killer) !== teamOf(victim)` (D5).
- `teamStrokes(team)` — sum over that team's live indices.
- `winner()` — fewest team strokes; equal is a draw; `"pending"` while `!over`.
- `mvp()` — highest points; a tie breaks to the **lower index**, stated so it is deterministic
  rather than whatever the loop happened to do. Zero kills across the board still returns a
  player, not null: a match with no kills has a leader on zero.
- `reset()` — clock back to `durationS`, both arrays zeroed.

**Tests, and the failure each must detect:**

1. A team kill scores the stroke and **no point**. Must be red against `points[killer] += 1`
   unconditionally.
2. An environmental death (`NO_KILLER`) scores the stroke and no point, and does not index
   `points[-1]`.
3. `winner()` is the team with **fewest** strokes. Must be red against a most-strokes-wins
   comparison — so the two teams' totals must differ, and the assertion must name which side.
4. `mvp()` ties break low. Must be red against `>=` in the comparison, which takes the highest
   index instead.
5. The clock ends **exactly** on the tick that reaches zero for a duration that is not a whole
   number of ticks. Must be red against `remaining <= 0`.
6. `teamStrokes` counts only that team. Give both teams strokes and assert each total
   separately — a test where one team has none is satisfied by summing everything.

### Task 1.3 — `Sim` delegates its clock

`Sim` holds `readonly match: Match`. `matchTimeRemaining` and `matchOver` become getters.
`step()`'s countdown block calls `this.match.tick(FIXED_DT)` and reads `this.match.over`;
`reset()` calls `this.match.reset()`.

The freeze-the-interpolation-pairs block on the closing tick stays exactly where it is — it is
`Sim`'s, not `Match`'s, and pitfall §1 instance 3 is about that block specifically.

**Evidence, not a new test:** `world.cart.test.ts`'s existing timer tests must pass **unedited**.
If one needs a change to go green, the delegation changed behaviour and that is the finding.
Confirm by running that file alone before and after.

---

## C2 — attribution

### Task 2.1 — the ball carries its shooter

`PooledBall.firedBy: number`. `BallPool.acquire(firedBy: number)` — **required parameter, no
default** (D6). `release`/`releaseAll` reset it to `NO_KILLER` so a recycled body cannot carry a
stale owner into its next flight.

`CombatRegistry.registerBall(handle, ball)` takes the `PooledBall`, and the `"ball"` actor
carries it. `registerCourseBall` is untouched — the course ball has no shooter and must not
acquire a fake one.

**Test:** a recycled pooled ball reports the new shooter, not the previous one. Force the recycle
path (`acquire` with every body flying/landed) rather than asserting on a fresh body — a fresh
body would pass with `release` not clearing anything.

### Task 2.2 — `Sim.rigs` index reaches `combat.ts`

`CombatRegistry.registerCart(handle, cart, index)`; the `"cart"` actor carries `index`.
`addCartRig` passes `this.rigs.length` **before** pushing.

**Test:** the index a cart is registered under is the index it has in `Sim.rigs`. The failure to
detect is an off-by-one from registering after the push — so build a sim with at least two bots
and assert the *last* one, where an off-by-one is out of range rather than merely wrong.

### Task 2.3 — the callbacks

`CombatContext` gains `onBallHit(shooter, victim)` and `onCartKilled(cart, killer)`.
`ctx.stats.directHits += 1` **leaves** `ballHitsCart`; `Sim`'s `onBallHit` credits it only when
`shooter === 0`.

`cartsShunt` attributes each death to the other cart (D5). Both carts dying in one contact
scores both, each attributed to the other.

**Tests:**

1. A bot's ball hitting the player no longer increments `stats.directHits`. This is a
   **behaviour change in stroke play** — write it as a positive assertion about the new rule, and
   confirm it is red against the shipped code.
2. The player's ball hitting a bot still does increment it. The control for (1): without it, (1)
   passes against `directHits` being removed entirely.
3. A ram kill is attributed to the other cart, not to `NO_KILLER`.

### Task 2.4 — spawn protection

`Cart.protectedFor`, counted down in `Cart.step`, cleared by `Cart.fire()` and set by
`Cart.revive()` — no: `revive()` is called by `Sim.reset()` too, and a fresh hole should not
hand out shields. **`Sim.stepRespawn` sets it**, and only there, so protection is a property of
respawning rather than of being alive.

`ballHitsCart` returns before damage while `protectedFor > 0`, alongside the existing `dead`
guard. Ramming is not blocked (D7).

**Tests:**

1. A protected cart takes no damage from a ball and the shooter gets no hit credit.
2. Firing ends protection **immediately** — assert on the tick after the shot, not after the
   timer would have expired anyway. Give the cart protection well in excess of the test's
   duration so the timer cannot be what ends it.
3. A protected cart still takes ram damage. This one is a rot guard; break the guard
   deliberately and watch it fail before believing it.

---

## C3 — the mode

### Task 3.1 — `src/sim/spawn.ts`

`createSpawnSet(holes: readonly PlacedHole[], heightAt)` → `SpawnPoint[]`, one per hole:
course-frame tee position at ground height + `CART_COLLIDER.groundOffset`, and a `heading`
pointing at that hole's cup **in the course frame** (D8).

`openingSpawn(set, index)` → `set[index % set.length]`.

`respawnPoint(set, random, carts, self)` → rejects any tee within `SPAWN_CLEARANCE_M` of a
living cart other than `self`, up to `SPAWN_TRIES` draws, then falls back to the tee **farthest
from its nearest living cart**.

DOM-free, Rapier-free, no `Math.random()`.

**Tests, and the failure each must detect:**

1. A spawn's heading points at its own cup. Use a hole whose placement rotation is **not** zero,
   so a heading computed in the hole's local frame is visibly wrong. A hole at rotation 0 makes
   the local and course answers identical and the test inert.
2. Every opening spawn for an 18-cart roster is a different hole's tee. Must be red against
   `set[0]` for everyone.
3. A respawn avoids a tee an enemy is parked on. Occupy one tee, draw many times, assert that
   tee is never chosen — a single draw can miss it by luck.
4. The fallback, when **every** tee is crowded, picks the farthest rather than index 0. Crowd
   all of them at differing distances and assert the specific tee.

### Task 3.2 — `loadCourse` becomes the mode switch

Signature gains the placed holes: `loadCourse(course, surfaces, holes)`. It performs, by name,
the seven steps in D10. The arena `Match` is constructed here with the current roster.

`Sim.arena` is `true` once it has run. `step()` skips the ball block — hole-out, water-for-the-
ball, `isPastFieldEdge` for the ball, `surfaceUnderBall` — when arena. The **cart's** water check
stays: driving into a pond is still a death, and it is now the environmental one from D5.

`killCart(cart, killer)` scores through `Match` and `stepRespawn` places the cart with
`respawnPoint` and grants `SPAWN_PROTECTION_S`.

**Tests:**

1. After `loadCourse`, `targets.length === 0` **and** `targetPartCount === 0` **and** no target
   part's collider handle resolves in the registry. Three assertions because a spec that says
   "removed" and leaves a registration is exactly pitfall §4.
2. The pin is gone and its handle does not resolve.
3. Every cart is at a different hole's tee and every one is on the ground — reuse
   `world.course.test.ts`'s `CELL_SLACK_M` tolerance.
4. Every cart's `health.max === ARENA_MAX_HEALTH`, and it does not change again over a played
   match. The second half is the D9 fix and must be red against a `setMaxHealth` call surviving
   in the respawn path.
5. A cart driven into water dies, scores its team one stroke, and gives nobody a point.
6. **D1's guard:** a cart that has absorbed hits without dying has `strokesTaken > 0` and
   `match.strokes[i] === 0`.

---

## C4 — the readouts

### Task 4.1 — HUD fields

Per D11. `HudSource.match?` optional; `HudState` gains `arenaVisible`, `golfVisible`,
`teamScoreText`, `pointsText`. `hud.ts` toggles the elements' `hidden`.

`index.html` gains the arena elements **empty** (pitfall §1, instances 5 and 6). Not `0`, not
`US 0 — THEM 0`. Empty.

**Tests:** with no `match`, `golfVisible` is true and `arenaVisible` false, and both text fields
are still strings. With a match, the reverse, and the team score names both sides' totals. The
failure to detect: a derivation that reads `source.match!` and throws for stroke play.

### Task 4.2 — `MatchResultsScreen`

Per D12. A `Screen` with `enter`/`step`/`draw`/`exit`. The decisions live in a DOM-free
`matchScoreboard.ts` (derive → state), the screen only writes strings — the split
`hudState`/`hud` already established, and the reason the rules are testable at all.

`enter()` releases pointer lock. Its root gets an explicit `z-index` above `#hud`, and the CSS
change is called out in the commit because no test can see paint order.

**Test:** the derived state names the winning team, its stroke total, and the MVP with their
points. Build it from a `Match` with an unambiguous winner and a non-zero, non-tied MVP so no
assertion is satisfied by a default.

---

## C5 — the scene

### Task 5.1 — `RenderScene` course path

Per D13. Optional `course` in the constructor; chase clearance from `course.terrain`; hole
ground, trees and water not built; `ground.update(camera)` in `draw`.

**Evidence:** `npm run gate` — `course-ground` is already a gate subject, so a mean delta of 0.00
on the hole subjects proves the course path did not disturb stroke play's.

### Task 5.2 — `ArenaScreen` and the route

Mirrors `RoundScreen`: sim, scene, input, HUD, nameplates, map. No pin marker, no longest-drive
tracking, no `onHoleComplete`; on `match.over`, route to `MatchResultsScreen`.

`main.ts` builds the course terrain and surfaces once, calls `sim.loadCourse`, and shows the
arena screen.

**Evidence:** `npm run smoke`. Add a check that the arena HUD's team score is **non-empty after
boot**, which the empty markup from Task 4.1 makes meaningful.

---

## Verification, in the order it has to run

1. `npx tsc --noEmit`
2. `npm test` — and record the count against the 826/55 baseline.
3. `npm run probe:terrain` — a control. The assembly is untouched; a change here means
   something moved that should not have.
4. `npm run plan` — all 18 SVGs byte-identical. Also a control.
5. `npm run probe` — red on the one known driver-distance line only. Do not read it as a
   regression without checking that.
6. `npm run gate`
7. `npm run smoke`

Then rewrite `docs/HANDOFF.md` as the baton, and add the `DECISIONS.md` entry for D1, D5 and D9
— the three that answered open questions rather than implementing settled ones.
