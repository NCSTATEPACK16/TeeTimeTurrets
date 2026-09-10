# Arena mode: the match itself — design

**Status:** design, 9 September 2026. Stage C of the arena work begun in
`docs/DECISIONS.md` § "Arena mode, and a course that is one place" (Stage A, the layout) and
§ "Assembling the course: influence, not a mosaic" (Stage B, the ground). Stage B shipped a
course you can drive end to end with stroke play's furniture still standing on it; this is the
mode that furniture is in the way of.

**Touches:** `src/sim/matchConfig.ts` (new), `src/sim/match.ts` (new), `src/sim/spawn.ts` (new),
`src/sim/world.ts`, `src/sim/combat.ts`, `src/sim/entities/Cart.ts`,
`src/sim/entities/BallPool.ts`, `src/ui/hudState.ts`, `src/ui/hud.ts`,
`src/ui/screens/MatchResultsScreen.ts` (new), `src/render/scene.ts`,
`src/ui/screens/ArenaScreen.ts` (new), `src/main.ts`, `index.html`.

**Not touched, deliberately:** `src/ui/screens/scorecard.ts`, `src/sim/round.ts`,
`src/sim/session.ts`. Those are stroke play's and arena has no card.

---

## 1. Why

Stage B left three things undone **on purpose**, and each of them is blocked on the same missing
thing: nothing in the codebase knows which mode it is in.

- `courseGround` is built, tested and gated, and nothing draws it. `RenderScene` takes one
  `Terrain` and uses it for four separate jobs.
- `loadCourse` re-tees every cart onto ground that exists and no further, so a match opens with
  every cart parked by the clubhouse on top of each other.
- The ball, the pin and the targets are stroke play's, built on `Sim.terrain`, and arena has
  none of them.

`src/sim/match.ts` is what the Stage B commits kept deferring to by name. It is the mode.

**And there is a fourth thing, which is older and which this spec has to answer to build
anything at all.** `docs/TEST-AND-SPEC-PITFALLS.md` §4 records it: *"Pooled balls carry no owner,
so `combat.ts` credits any ball's hit to the player."* Arena scores kills. A kill is a fact about
**who fired the ball**, and that fact does not currently exist anywhere in the sim. This has been
deferred twice because it was latent — `accuracy()` has no non-test caller. It stops being latent
here.

---

## 2. What arena is, restated from `DECISIONS.md`

A timed, team-based cart deathmatch across all eighteen holes joined into one drivable course.

- **Kills score points.** Points decide the individual MVP.
- **Deaths score strokes.** Strokes are team-aggregated, and the team with the **fewest** wins.
- No played ball, no scorecard, no par, no holing out. The cart's golf balls are ammunition.
- Carts start spread across the eighteen holes and respawn at a random tee.

The tension — the team wins by not dying, the MVP badge goes to whoever kills most — is the
design. Do not make the two awards agree.

---

## 3. Decisions

### D1 — There are two meanings of "stroke" in this codebase and they are not the same number

`Cart.strokesTaken` counts **ball hits absorbed**, one per hit, and is the score of the
cart-combat mode that shipped 3 September. Arena's stroke is a **death**. These differ by the
health bar: at 8 HP a cart takes eight `strokesTaken` per one arena stroke.

They stay separate, in separate places. `Cart.strokesTaken` is untouched and keeps its meaning
and its consumers (`Sim.matchOutcome`, `matchResultsState.ts`). Arena's strokes live on
`Match`, are incremented once per death, and are never derived from `strokesTaken`.

**This is the spec's highest-risk sentence and the reason it is first.** A future reader who
folds the two together gets a scoreboard that is wrong by a factor of the health bar and looks
plausible at every value. The test that pins it must be one where the two numbers *cannot*
coincide — a cart that has taken hits without dying, so `strokesTaken > 0` and arena strokes
are still 0.

### D2 — `Match` owns the clock, and it owns it in both modes

`Sim` already has `matchTimeRemaining`, `matchOver` and `matchDurationS` as three fields and a
countdown in `step()`. `Match` takes all four. `Sim.matchTimeRemaining` and `Sim.matchOver`
become getters delegating to it, so every existing caller — `HudSource`, `matchResultsState`,
the smoke driver — is unchanged.

One clock, not two. A second countdown living beside the first is the same class of defect as a
second `bestBotStrokes` loop, and that one is already recorded in `TEST-AND-SPEC-PITFALLS.md` §2.

Stroke play gets a `Match` too. Its scoreboard fields go unread there, which is cheaper and far
less error-prone than a nullable clock every caller has to branch on.

### D3 — Every player-indexed structure is sized for 24, and the index is the rig index

`MAX_PLAYERS = 24`. `Match` holds `points` and `strokes` as fixed-length arrays of that size,
allocated once. This build ships single-player against bots and will not fill them.

The identity of a player is **its index in `Sim.rigs`** — 0 is always the human. That index is
already the one `bots[i]`, `currentBotCarts[i]` and the nameplates use, so introducing a second
identity would immediately need a mapping between them.

### D4 — Teams alternate by index, and the player is always on team 0

`teamOf(index) = index % TEAM_COUNT`, `TEAM_COUNT = 2`. Alternating rather than splitting in
half so that **any** roster size gives sides that differ by at most one, including the 1-player,
1-bot case this build actually runs. A 24-player match is 12 and 12 either way.

### D5 — A kill is attributed, an environmental death is not, and a team kill scores neither side a point

- Ball kill by an enemy: killer **+1 point**, victim's team **+1 stroke**.
- Ball kill by a team-mate: **no point**, victim's team **+1 stroke**. Points are for enemies;
  a team kill still cost the team a life, which is the punishment.
- Ram kill (`cartsShunt`): treated exactly as a ball kill, attributed to the other cart. A ram
  that kills both carts in one contact scores both, each attributed to the other.
- Drowning, or any death with no other cart involved: **+1 stroke, no point.** Attribution is
  the sentinel `NO_KILLER = -1`.

### D6 — The ball carries its shooter, and this is what closes pitfall §4

`PooledBall` gains `firedBy: number`. `BallPool.acquire(firedBy)` requires it — a parameter with
no default, so every call site is forced to answer the question rather than inheriting a wrong
answer silently. `CombatRegistry` maps a ball's collider handle to the `PooledBall`, not just its
body, so `combat.ts` can read it.

`CombatContext` gains two callbacks and loses one direct mutation:

```
onBallHit(shooter: number, victim: Cart): void
onCartKilled(cart: Cart, killer: number): void
```

`ctx.stats.directHits += 1` moves out of `ballHitsCart` and behind `onBallHit`, where `Sim`
credits it only when `shooter === 0`. That is the pitfall §4 fix, and it is a behaviour change
in stroke play too: a bot's hit on the player no longer inflates the player's accuracy. Say so
in the commit.

`Sim.ball` — the dormant course ball — is `courseBall`, has no shooter, and is not routed through
either callback. It already cannot hurt a cart.

### D7 — Spawn protection is a timer the cart owns, and firing gives it up

`Cart.protectedFor: number`, seconds, counted down in `Cart.step`. While above zero,
`ballHitsCart` returns before applying damage, exactly as it already does for `cart.dead`.

**Firing zeroes it.** Without that, the correct opening move is to sit on a tee shooting from
behind a shield. `Cart.fire()` sets it to 0, which is one line and is the whole rule.

Ramming is deliberately *not* blocked by protection: a protected cart is untouchable by fire,
and making it untouchable by a vehicle as well means it can also park itself inside an enemy
with impunity.

### D8 — Spawns come from the eighteen tees, in the course frame, from a seeded stream

`src/sim/spawn.ts` turns `PlacedHole[]` into `SpawnPoint[]` — one per hole, at
`toCourseFrame(placement, spec.tee)`, at course height, facing down the hole toward its cup.
Facing matters: a cart spawned at yaw 0 on hole 14 is pointing at whatever is west of it.

- **Opening spawns** are dealt deterministically: rig `i` takes tee `i % holes.length`. Spread
  across the eighteen holes, reproducible, and no RNG needed for something that has no reason to
  vary within a seed.
- **Respawns** draw from the seeded stream, rejecting any tee within `SPAWN_CLEARANCE_M` of a
  living cart, up to `SPAWN_TRIES` attempts, then falling back to **the tee farthest from the
  nearest living cart** rather than to an arbitrary one. A fallback that picks tee 0 puts every
  contested respawn on the same tee.

Never `Math.random()`. The stream is injected, per `AGENTS.md`.

### D9 — Arena health is a flat number, decided here, out loud

`docs/HANDOFF.md` has carried "cart health is `2 × par` and `loadHole` re-sizes it, so advancing
par 3 → par 5 heals the player" for several sessions, unanswered. **Arena has no par**, so it
cannot inherit the rule and something has to be chosen.

`ARENA_MAX_HEALTH = 8`. One ball hit is one point (`STROKE_DAMAGE`), so eight hits kill —
inside the 6–10 band `2 × par` produces, so the combat feel Stage A tuned carries over, and a
flat number because the thing that varied it does not exist in this mode.

It is set **once**, by `loadCourse`, and nothing re-sizes it afterwards. That is the actual
content of the fix: the defect was never the number, it was `setMaxHealth` refilling the bar as
a side effect of a mode-level event.

### D10 — `loadCourse` is where the mode changes, and it must name every piece of furniture it removes

`TEST-AND-SPEC-PITFALLS.md` §4 records what happens when a spec says a thing "becomes dormant"
without naming the registration it has to leave: `Sim.ball` stayed a registered `"ball"` actor
and driving over your own tee became lethal.

So, by name. `loadCourse(course, surfaces, holes)` must:

1. swap the playfield and rebuild the ground collider *(already does)*;
2. `removePin()` — and the pin's collider handle must leave `CombatRegistry`, which
   `removePin` already does via `unregisterPin`;
3. dispose every `Target` and unregister its parts, leaving `targets.length === 0` and
   `targetPartCount === 0`;
4. `ballPool.releaseAll()`, and park the course ball below the world so no `isGrounded`,
   `isInCup` or water check can ever see it;
5. size every cart to `ARENA_MAX_HEALTH`;
6. build the `SpawnSet` and place every cart at its opening tee, facing its cup;
7. construct the arena `Match` with the roster it now has.

`holedOut` is unreachable afterwards because the ball is parked, but the spec does not rely on
that: `step()` skips the ball's whole block in arena.

### D11 — The HUD keeps its golf fields and gains arena ones; visibility is a flag, not a deletion

`HudState` gains `arenaVisible`, `teamScoreText`, `pointsText`, and `golfVisible`. `deriveHudState`
sets `golfVisible = !arena` and `arenaVisible = arena`. `strokesText` and `pinDistanceText`
keep being derived either way — a blank field is a rendering decision and a missing one is a
crash — and `hud.ts` hides the elements, per UI-SPEC §5's existing rule that H6/H7 hide rather
than show inert.

`HudSource` gains an optional `match` slice. Optional so every existing test fixture in
`hudState.test.ts` still constructs a valid source.

### D12 — `MatchResultsScreen` is a real `Screen`; the existing overlay stays where it is

`src/ui/matchResults.ts` is the cart-combat overlay: one boolean, no lifecycle, bound to
`Sim.matchOutcome()`. It stays, unchanged, for the mode it was built for — deleting it would be
deleting stroke play's combat ending to make room for arena's.

Arena gets `src/ui/screens/MatchResultsScreen.ts`, registered with `ScreenManager`: team
strokes, the winning side, the MVP and their points, PLAY AGAIN and MAIN MENU.

**Two things `TEST-AND-SPEC-PITFALLS.md` §5 requires of it, because no headless test can see
either.** It must release pointer lock on entry — a mouse-aim player cannot click a button
through a captured cursor. And its container needs an explicit `z-index` above `#hud`, because
two `position: fixed` siblings at `z-index: auto` stack in DOM order and the HUD currently wins.

**And one §1 requires of its markup:** whatever `index.html` ships for it must be **empty**, not
a plausible placeholder. `<h1 id="results-headline">DRAW</h1>` is how two smoke checks came to
pass with the feature deleted.

### D13 — `RenderScene` learns about a course by being handed one, not by inspecting what it has

`RenderScene`'s constructor gains an optional `course?: { terrain: CourseTerrain; ground:
CourseGround }`. When present:

- the chase camera's ground clearance samples `course.terrain.heightAt`, not the hole's;
- the hole's ground mesh, trees and water plane are not built at all;
- `draw()` calls `ground.update(cameraX, cameraZ)` so the tile refinement follows the camera.

Explicitly handed rather than derived, because "which ground is this" is exactly the question
`playfield.ts` already answered for the sim and it was answered by an injected object there too.

**A known consequence, carried from Stage B and not fixed here:** a near tile costs ~65 ms of
building, spread at 2.5 ms per frame, so about 26 frames to refine one. A respawn is a teleport.
The player will land on 8 m ground and watch it sharpen. That is a real artefact of shipping
this, it is not a regression, and it is named in the loose ends rather than papered over.

---

## 4. Phases

**C1 — the scoreboard.** D1, D2, D3, D4. `matchConfig.ts`, `match.ts`, `Sim` delegating its
clock. No behaviour change visible anywhere: the clock keeps counting the way it did, and this
is provable by the existing `world.cart.test.ts` timer tests staying green without edits.

**C2 — attribution.** D5, D6, D7. The ball carries its shooter, combat reports who did what,
carts have spawn protection. Closes pitfall §4. Touches stroke play (the accuracy credit) and
says so.

**C3 — the mode.** D8, D9, D10. `spawn.ts`, and `loadCourse` becoming the mode switch.

**C4 — the readouts.** D11, D12. HUD fields and the results screen.

**C5 — the scene.** D13. `RenderScene`'s course path and `ArenaScreen`, and `main.ts` routing
to it.

C1–C3 are sim-only and Node-testable. C4 is DOM-split the way `hudState`/`hud` already is. C5
is the only phase whose evidence is `npm run gate` and `npm run smoke` rather than `npm test`.

---

## 5. What has to be true to call it done

1. `tsc --noEmit` clean; `npm test` green with no test deleted or loosened.
2. A match ends on the clock and the scoreboard freezes with it — asserted on the numbers a
   consumer reads, not on live entity state (pitfall §1, instance 3).
3. A cart killed by an enemy's ball gives that enemy exactly one point, and the victim's team
   exactly one stroke. Killing with a **team-mate's** ball gives no point and still gives the
   stroke — and the test proving it must be red against attributing every hit to the player,
   which is the behaviour that ships today.
4. A cart that has taken hits and not died has `strokesTaken > 0` and arena strokes `0`. (D1.)
5. Every cart opens the match at a different hole's tee, and a respawn lands on a tee that is
   not the one an enemy is standing on.
6. Nothing in `src/sim/**` calls `Math.random()`; `npm test`'s node environment still refuses
   `three`/DOM imports there.
7. `npm run probe:terrain` PASS, `npm run plan` byte-identical — neither the assembly nor any
   hole generation is touched, so both are controls rather than checks.
8. `npm run gate` and `npm run smoke` PASS for C5.

## 6. Out of scope, named so it is not mistaken for missing

- **Pickups** (Stage D). `Pickup.ts` stays one hardcoded bucket.
- **The clubhouse and tee signs** (Stage E).
- **Bridge in the ground splat.** Still `weights.bridge` computed and read by nobody; a fifth
  channel needs a second sampler, which is not this.
- **Bot behaviour.** `computeBotIntent` still engages the player and only the player. A bot
  that picks the nearest enemy is a real change to `bot.ts` and belongs with the roster that
  makes it matter.
- **Draw calls.** 78 per cart × 24 is 1,872, and `mergeGraphInstances` is the tool. Named in
  the handoff, not attempted here.
- **Macro relief across the course.** Still flat between holes; still a decision, not a bug.
