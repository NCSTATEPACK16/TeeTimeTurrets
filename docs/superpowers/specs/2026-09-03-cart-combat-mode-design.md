# Cart-Only Combat Mode — Design

## 1. Decision

Remove stationary/get-out-and-swing play as the game's active mode. The cart and its turret
become the only way to play. Firing a golf ball is no longer gated by "is a ball loaded from
lying on the course" — that mechanic was already retired by BACKLOG #16d in favour of a pooled
ammo counter, and this decision finishes the thought: the cart is now the *only* place a shot
comes from, full stop.

Redefine what a "stroke" means in this mode. It is no longer "you swung." It is **damage
taken**: getting hit by an enemy's ball, or driving your own cart into water, each cost exactly
one stroke and remove exactly one point of health. Health is sized at **double the hole's par**
— a par-4 hole gives each cart 8 hit points, and the eighth hit kills. Least strokes taken (=
most health remaining) when the match timer expires wins. There is no opponent to compare
against today, so this also adds a single basic AI-controlled bot cart, and a minimal results
screen to show the outcome.

Today's stroke-play golf mechanic (`Sim.ball`, `Sim.launch()`, hole-out and water-for-the-ball,
the `SwingMode` toggle) is **not deleted**. It becomes unreachable — no input path drives it —
and stays in the tree as a dormant reference for a possible future "true golf" mode. This is a
deliberate exception to the project's usual "delete rather than rewire stale code" rule
(BACKLOG #16d), made because the user has stated an intent to build that mode later and the
code is a working, tested reference for it.

## 2. Current state (grounding facts)

- `SwingMode` (`src/sim/world.ts`) is `Stationary | Cart`. `Sim.mode` defaults to `Stationary`.
  `PlayerIntent.toggleMode` flips between them. Stationary is the only path that ever calls
  `Sim.launch()`.
- `Sim.ball` is a single persistent Rapier body. `Sim.step()` checks it every tick for
  out-of-bounds, hole-out, and water, and `Sim.strokes` is incremented only by `launch()`.
- `Sim.cart` is a single `Cart` instance (`src/sim/entities/Cart.ts`) — chassis position/heading,
  turret yaw, equipped club, charge/reload, ammo, `Health`, `dead`/`respawnTimer`. There is
  exactly one; nothing in `Sim` iterates "carts."
- Cart-mode firing spawns from `BallPool` (`src/sim/entities/BallPool.ts`, `POOL_SIZE = 32`),
  rendered by `BallSwarm`. `src/sim/combat.ts` already dispatches ball↔target and ball↔cart
  contact events by collider handle through a `CombatRegistry`, and already calls `applyDamage`
  on a hit cart's `Health` — today at a velocity-scaled amount (`DAMAGE_PER_MPS = 1.5`,
  clamped `MIN_HIT_DAMAGE = 5` / `MAX_HIT_DAMAGE = 60`).
- Cart-vs-cart shunting (`SHUNT_DAMAGE_PER_MPS = 0.8`) is a separate contact path in the same
  file, also calling `applyDamage`.
- `Health` (`src/sim/health.ts`) is `{ hp, max }`, plain data, `applyDamage`/`heal` as pure
  transforms. `createHealth(max)` sets both fields to the given max.
- Death/respawn already exists end to end: `Cart.dead`, `Cart.respawnTimer`,
  `Sim.stepRespawn()`, `cartSpawnPosition()`. Intent is ignored entirely while dead.
- `src/sim/rng.ts` has `mulberry32` + `hashChannel`, a seeded-PRNG pattern already used
  elsewhere in `src/sim/**`. `applyAimSpread` (in `src/physics/Ballistics.ts` per BACKLOG #5)
  takes an injected `random` and nothing currently wires one in.
- `docs/UI-SPEC.md` §1/§5 describe two HUD configurations keyed off `SwingMode`, and a rule that
  H6/H7 (health/ammo) must hide rather than show inert. Both assumed two modes existed.
- No AI, no bot, no second cart, and no results/match-end screen exist anywhere in the codebase
  today. Phase 1.75's `ScreenManager` (title/round/results/settings) is unbuilt.

## 3. Mode removal

`SwingMode` and `Sim.mode` stay in `world.ts`, and `Sim.ball`/`launch()`/the hole-out and
water-for-the-ball logic in `step()` stay exactly as they are — untouched, just orphaned.
`PlayerIntent.toggleMode` and the branch in `stepCart()` that reads it are deleted, so nothing
can ever set `mode` to `Stationary` again after construction; `Sim` is created already in
`SwingMode.Cart` and stays there for the sim's lifetime. `stepCart()`'s `driving` branch (today
`this.mode === SwingMode.Cart`) becomes always-true and can be simplified away, but the field
and the branch structure around `resolveShot()`'s stationary half are left in place rather than
physically deleted, per the dormant-code decision above.

`src/ui/hudState.ts`'s `combatVisible` (today `inCart`) becomes unconditionally `true` — there
is only one HUD configuration now. `UI-SPEC.md` §1/§5 get a note that the two-HUD split is
dormant along with `SwingMode`, for the same future-mode reason.

## 4. Multi-cart support

`Sim.cart` stays exactly as it is today — the player's cart, same field name, same shape, so
every existing call site in `main.ts`, `render/scene.ts`, `hudState.ts`, and the test suite
keeps working unmodified. A new field, `readonly bots: Cart[]`, holds AI-controlled carts —
sized to 1 for this build, but an array because nothing about the design assumes exactly one.

Each entry is a full, independent `Cart` instance: its own position/heading/turret, its own
`Health`, its own ammo/reload/charge state. `Sim.step()` steps every bot's `Cart` the same way it
steps the player's — through the shared `Cart.step()` state machine — except the intent driving
it comes from `computeBotIntent()` (§7) instead of the player's `InputSource`, and a bot never
reads `PlayerIntent.toggleMode` (moot, since mode is gone) or `selectClub` unless the bot logic
chooses to swap clubs, which this build does not attempt.

Combat contact dispatch (`combat.ts`) already keys hits by collider handle through a registry
that maps handle → entity; extending it from "the one cart" to "the player's cart or any bot's
cart" is a registration-time change (register every bot's collider alongside the player's), not
a shape change to the dispatch logic itself.

## 5. Damage, strokes, and health

`Health.max` is set to `2 × hole.par` at creation (both for the player's cart and every bot's),
replacing today's arbitrary fixed max. A new constant, `STROKE_DAMAGE = 1`, replaces the
velocity-scaled amount at exactly two call sites in `combat.ts`:

- **Ball hits a cart** (player's or a bot's): `applyDamage(cart.health, STROKE_DAMAGE)` instead
  of the `DAMAGE_PER_MPS`-scaled amount. `MIN_HIT_DAMAGE`/`MAX_HIT_DAMAGE` become dead constants,
  left in place for the dormant reasons above (a future mode may want graduated damage back).
- **A cart drives into water**: new. `Sim.step()` gains a per-cart water check (below), calling
  the same `applyDamage(cart.health, STROKE_DAMAGE)`.

**Cart-vs-cart shunting is explicitly out of scope for scoring.** It keeps its existing
velocity-scaled `applyDamage` call, unchanged — ramming another cart is a physical shove, not a
stroke. (This is the one place in this spec where the user's stated rule — "you get a stroke
when you get hit with a golf ball, if you drive into the water" — was silent, and shunting was
read as excluded rather than included. Flagged here so the implementation plan or a reviewer can
correct it if that reading is wrong.)

"Strokes taken" is never stored as its own counter. It is `health.max - health.hp`, computed
wherever it's needed (HUD, results screen, win-condition comparison) — this is what "double par
is your full health bar" means literally, and a derived value can't drift out of sync with the
health it's derived from.

## 6. Water hazard, per cart

`Sim.step()` gains a check, run once per cart (player and every bot) after that cart's movement
for the tick: `surfaces.surfaceAt(cart.x, cart.z) === SurfaceId.Water`. Edge-triggered — only on
the tick a cart *enters* water, tracked with one boolean per cart (`wasInWater`, alongside the
cart's other per-tick state), not level-triggered, so a cart sitting in shallow water is not
drained every tick. On the entering tick: `applyDamage(cart.health, STROKE_DAMAGE)`, then
reposition the cart to its last-known non-hazard position — mirroring `dropAtLastSafePosition()`,
which already exists for the ball; a cart needs the same "last safe spot" tracking the ball has,
maintained the same way (recorded whenever the cart is grounded, slow, and not on a hazard
surface — reusing the existing `REST_HOLD_TICKS`-style debounce is not required for a cart, since
a cart doesn't bounce the way a ball does; recording last-safe-position on every tick the cart is
not on a hazard surface is sufficient).

If this fires on a bot's cart mid-death-respawn-flow, it doesn't — `stepRespawn()` already
skips all other per-tick logic for a dead cart, and the water check runs inside the same
"cart is alive" branch of `stepCart()`.

## 7. AI bot

`src/sim/bot.ts`, DOM-free like everything else in `src/sim/**`, exporting one pure function:

```ts
export function computeBotIntent(
  bot: Cart,
  target: { x: number; z: number },
  random: () => number,
): PlayerIntent
```

Structural, not a method on `Cart` or `Sim` — takes exactly the slice of state it needs (its own
cart, the position it's engaging), the same pattern `hudState.ts`'s `HudSource` already
established for testability. `Sim.stepCart()`-equivalent for each bot calls this once per tick,
passing the player's current position as `target`.

Behaviour, deliberately simple (no pathfinding):

- **Engagement range** — a bot only closes distance and fires within `BOT_ENGAGE_RANGE` (a
  tunable constant, default `40` — inside a hole's typical corridor width, so a bot on the same
  hole as the player is always eventually in range without crossing into a neighbouring hole's
  space). Outside that range, it idles (zero throttle) rather than pathfinding across the whole
  course.
- **Approach** — throttle and steer computed from the heading-to-target error, the same shape a
  simple "turn toward and drive" controller takes; no slope/hazard awareness beyond what
  `cartSpeedScale` already provides for free through the shared `Cart.step()`.
- **Aim** — turret yaw eases toward the bearing to the player, at a bounded turn rate (so aim is
  not instant/omniscient), then fires an aim-spread offset through `applyAimSpread` with the
  injected `random` — this is BACKLOG #5's "just wiring a per-shot channel" finally getting a
  caller, scoped to the bot only; the player's own shots are unaffected by this build.
- **Fire** — fires when roughly aimed (turret bearing to player within a tolerance) and off
  reload cooldown, gated by the bot's own ammo exactly the way the player's is. A bot that runs
  out of ammo does not seek out a pickup bucket in this build — it simply stops firing until
  `Sim.reset()`/a new match. (Bucket-seeking is real pathfinding and explicitly deferred.)

The bot's `random` is a per-bot seeded channel from `src/sim/rng.ts`'s `hashChannel`, not a
shared or global generator — keeps bot behaviour reproducible per seed, consistent with every
other seeded system in `src/sim/**`.

## 8. Match timer and win condition

`Sim` gains `matchTimeRemaining: number` (seconds) and `matchOver: boolean`. A constant,
`MATCH_DURATION_S`, defaults to `180` (3 minutes) for real play; `Sim.create()` (or a new
optional param on it) accepts an override so tests can run a match to completion in a handful of
ticks rather than 180 real seconds — the "I don't want your test case to run forever" concern
from this design's brainstorming, solved at the call site rather than by shrinking the real
default.

Each `Sim.step()` decrements `matchTimeRemaining` by `FIXED_DT` while `!matchOver`. At zero,
`matchOver` is set once, and every subsequent `step()` short-circuits before touching any
cart's intent — mirrors how `holedOut` and `cart.dead` already gate the tick, just at the
whole-`Sim` level instead of per-entity. The winner is whichever of {player, each bot} has the
highest `health.hp` remaining (fewest strokes taken); a tie is a draw, reported as such rather
than picking an arbitrary winner.

Death before the timer expires does **not** end the match by itself — a dead cart respawns and
keeps accumulating (or, since it's already at 0 hp, simply stays dead-and-respawning) until the
clock runs out. The timer is the only match-end trigger in this build.

## 9. Results screen (minimal slice, not full Phase 1.75)

One new DOM overlay, `#match-results` in `index.html`, hidden by default, shown when
`sim.matchOver` becomes true. Contents: winner name/text ("YOU WIN" / "BOT WINS" / "DRAW"), both
strokes-taken numbers, a "PLAY AGAIN" button. `src/ui/matchResults.ts` follows the same
`readMatchResults()`/`drawMatchResults()` split `src/ui/hud.ts` already established for H6/H7 —
DOM-free derivation, thin DOM-writing half — reusing that pattern rather than inventing a new
one. "Play again" calls the same reset path `R` already triggers (`Sim.reset()`), which needs to
also re-roll `matchTimeRemaining`/`matchOver` and re-seed the bot(s) alongside everything it
already resets.

This is explicitly not `ScreenManager` — no enter/exit lifecycle, no scene residency question,
no second screen to register. It's one overlay gated by one boolean, the smallest thing that
gives the match a real ending instead of just freezing.

## 10. Presentation: nameplates

Per BACKLOG #34b (already scoped, previously slated for Phase 4): a name pill + health bar
positioned above each cart using the existing world→screen projection formula
(`docs/ARCHITECTURE.md` §2c), persisted per-frame rather than one-shot like a hit marker. Built
for both the player's cart and every bot — the player doesn't strictly need a nameplate over
their own cart (it's off-screen/behind the camera most of the time), but building it symmetric
for player and bot is simpler than a special case, and multiplayer (Phase 5) will want every
cart nameplated anyway.

## 11. Error handling / edge cases

- **A bot's target (the player) is dead/respawning.** `computeBotIntent` still receives a
  position (the respawn point) and aims at it; since the player is untouchable while dead
  (existing respawn logic ignores intent, but nothing stops a bot's ball from being fired *at*
  the respawn point) — decide in the implementation plan whether a dead player should be
  excluded as a valid bot target for the engagement-range check, to avoid a bot "camping" a
  respawn point. Flagged as an open question, not resolved here.
- **Multiple simultaneous water entries** (player and bot both enter water the same tick): each
  cart's edge-trigger is independent per-cart state, so this is not a shared-state race —
  confirmed safe by construction, not something that needs a lock or ordering rule.
- **A cart dies exactly as the match timer hits zero.** `matchOver` is checked/set once per tick
  before intent processing; a death and the timer reaching zero in the same tick resolve in
  step() order (health check inside combat resolution happens before the timer decrement is
  checked at the top of the next tick) — the health state at the moment of death is still what
  the results screen reads, so this is not a real race, just worth the implementation plan
  writing a test for the exact-tick boundary.
- **`Sim.reset()` while `matchOver` is true.** Must clear `matchOver` and re-roll
  `matchTimeRemaining` — the existing `reset()` already re-seeds most per-hole state; this is one
  more field added to that list, not a new code path.

## 12. Testing

Everything above lives in `src/sim/**` and is DOM-free by construction, so it follows the
project's existing test seam: `Sim`'s public snapshot/state surface, exercised through real
`step()`/`reset()` calls, never by reaching into Rapier bodies directly (per
`docs/superpowers/plans/*`'s established convention). `computeBotIntent` is independently
testable as a pure function — given a bot cart and a target position, assert the returned intent
points roughly the right way, fires only in range/off-cooldown/with ammo, and is deterministic
for a fixed seed. The water-hazard-per-cart and match-timer/win-condition logic get the same
treatment `world.render.test.ts` already gives snapshot buffers: drive a real `Sim` through
`step()` and assert on its public fields.

## 13. Open parameters for the implementation plan

- `STROKE_DAMAGE = 1` (health lost per ball-hit or water-entry).
- Health max formula: `2 × hole.par` (a par-4 hole → 8 hp).
- `MATCH_DURATION_S = 180` default, overridable per `Sim.create()` call for tests.
- `BOT_ENGAGE_RANGE = 40` (metres) — bot idles outside this, engages within it. Tunable by
  playtesting once a bot exists to actually play against.
- Bot aim ease rate and fire-tolerance angle — not numerically pinned here; the implementation
  plan should pick starting values and note they're playtest-tunable, the same way
  `docs/ROADMAP.md` already treats several combat numbers as "wants a play session" rather than
  blocking on an exact figure now.
- Whether a dead/respawning player is excluded as a valid bot engagement target (§11) —
  recommend excluding, to be confirmed in the plan.
- Whether cart-vs-cart shunting should also cost a stroke (§5) — recommend no (current reading),
  to be confirmed in the plan.
