# Targets, Ragdolls, and Health/Damage — Design

**Date:** 2 Sep 2026 · **Status:** implemented (sim), 2 Sep 2026 · **Roadmap slot:** Phase 3

**Implementation:** `docs/superpowers/plans/2026-09-02-targets-health-combat-implementation.md`,
which resolves §9's open parameters and records three departures from this document: contacts are
dispatched through a collider-handle registry rather than `{ targets, carts, stats }` (a drained
event carries only handles); `health.ts` lives at `src/sim/health.ts`, the path §1 and `ROADMAP.md`
name, not the `entities/` path §3's comment names; and `BALL_DENSITY` was **not** raised, because
the ratio §2 asks for is already met — see that plan and the corrected `DECISIONS.md` "Ball mass".

Fulfils `docs/ROADMAP.md` Phase 3's `Target.ts`/ragdoll item, the `BALL_DENSITY`/ball-mass item,
"Hit detection via Rapier collision events," and "Health and damage" (`src/sim/health.ts`).
Builds on the already-shipped ammo/pooled-ball system
(`docs/superpowers/specs/2026-09-02-cart-ammo-design.md`). Also partially fills the "Round stats
recorded from the start" item (direct hits, targets down, accuracy) via a minimal tracker — see
§6.

## 1. Decision

Cart-mode combat gets real consequences: a ball hitting a `Target` knocks its ragdoll down, and a
ball hitting a cart (or a cart shunting another cart) damages it. Damage is detected via Rapier's
`EventQueue` (real contact events, not proximity polling), scaled from the ball's impact speed so
a full-charge driver hits harder than a chipped shot, and resolved by a new orchestrator module,
`src/sim/combat.ts`, that sits alongside `world.ts` rather than inside it — following the same
leaf-module split `BallPool.ts`/`Pickup.ts` established for the ammo system.

Death is not a dead end: a cart at 0 HP takes a **stroke penalty** (mirroring the existing
water-hazard rule) and respawns at the tee-adjacent spawn point after a short delay, matching the
user's explicit framing — "less deaths (stroke penalty if you die, go in the water, etc.), still
respawn after a delay."

**Explicitly out of scope for this spec** (deliberate simplifications, not oversights):

- **Mode-scoping** (`ROADMAP.md`'s "STROKE runs with damage/ammo disabled" rule). `SwingMode`
  only has `Stationary`/`Cart` today — there is no STROKE/CTF/TARGETS switch to scope against
  yet. When that switch lands, disabling this spec's damage/health for STROKE mode becomes one of
  its cases, same as ammo.
- **A second cart in the live game.** The sim has exactly one `Cart` today — no multiplayer, no
  AI opponent. Cart-vs-cart shunting damage is implemented as real code (not stubbed), and
  covered by tests using a synthetic second cart body, per explicit user decision, but has no
  in-game way to trigger until a second cart exists.
- **Target auto-recovery.** A knocked-down target stays down until `Sim.reset()` (new hole). No
  "stands back up after N seconds" behavior — not asked for, and re-animating a ragdoll back to a
  held pose is unspecified work `DECISIONS.md` doesn't cover.
- **Full `round.ts` / `ResultsScreen`.** §6's stats tracker is a minimal, round-scoped object
  built to be absorbed by `round.ts` once Phase 1.75 resumes — not a re-implementation of that
  phase.
- **Rendering, HUD, health bars.** Sim logic only, matching every prior phase's ordering.
- **Food & drink pickups, trees.** Separate, already-identified Phase 3 items; not touched here.

## 2. Current state (grounding facts)

- Rapier collision events are enabled nowhere in this codebase today — every existing check
  (`isGrounded`, `ballInReach`, `BallPool.ballsNear`) is proximity/velocity polling, not
  `EventQueue`-driven.
- `DECISIONS.md`'s "Ragdolls" entry already settles the hard physics questions: pose held by
  body-type (`Fixed`/`KinematicPositionBased` → `Dynamic` on impact), not joint stiffness (inert
  in the JS bindings); revolute limits set on the created joint object; spherical shoulders/hips
  with damping, not motors (removed/unverified). This spec does not re-litigate any of that — see
  that file for the full reasoning.
- `DECISIONS.md`'s "Ball mass" entry already settles the density question: raise `BALL_DENSITY`
  until the ball-to-heaviest-ragdoll-part mass ratio is ≤ 1:20, clamp post-impact ragdoll
  velocities, and confirm via `npm run probe` that Phase 0/1.5 numbers are unchanged (ball flight
  is mass-independent against a fixed collider).
- `Cart.ts` already owns one piece of clamped, capped state this way — `ammo`/`addAmmo` — which
  `health`/`applyDamage` mirrors.
- The existing stroke-penalty pattern lives in `world.ts`'s water-hazard handling: `strokes += 1`
  then `dropAtLastSafePosition()`. Death reuses this shape rather than inventing a new one.
- `cartSpawnPosition(terrain)` already exists (behind the tee) and is what a new hole spawns the
  cart at — reused as the respawn point rather than defining a second spawn location.
- `DECISIONS.md`'s physics-ownership table is explicit: **a `KinematicCharacterController`
  receives no impulses.** Recoil is a velocity term `Cart.ts` owns and decays itself; "same for
  being shunted by another cart" is called out by name. Cart-vs-cart shunting must follow the
  same pattern as `recoil`, never `applyImpulse`.

## 3. Data model

```ts
// src/sim/entities/Target.ts (new)
export const TARGET_CAPSULE_COUNT_RANGE = [7, 11] as const; // pelvis, torso, head, upper/lower arm x2, upper/lower leg x2

interface TargetPart {
  body: RAPIER.RigidBody;   // Fixed at rest, flipped to Dynamic on impact
  collider: RAPIER.Collider;
}

class Target {
  readonly parts: TargetPart[];
  isDown: boolean;                              // true once any part has flipped to Dynamic
  knockDown(impactPart: TargetPart, impulse: RAPIER.Vector): void; // flips that part (and, via its joints, the rest of the rig) to Dynamic
  reset(): void;                                // back to Fixed pose, isDown = false — used by Sim.reset()
}
```

Self-collision between adjacent capsules is disabled via Rapier collision groups (per
`DECISIONS.md`), and no part gets CCD (reserved for the ball only, per the same entry).

```ts
// src/sim/entities/health.ts (new — pure, no Rapier)
export interface Health {
  hp: number;
  readonly max: number;
}

export function createHealth(max: number): Health;              // hp starts at max
export function applyDamage(h: Health, amount: number): boolean; // clamps hp to >= 0; returns true iff this brought hp from >0 to 0 (a kill)
export function heal(h: Health, amount: number): void;           // clamps to max
```

```ts
// src/sim/entities/Cart.ts additions
export const STARTING_HP = 100;
export const RESPAWN_DELAY_S = 3;

class Cart {
  readonly health: Health;      // createHealth(STARTING_HP)
  dead: boolean;                // true while awaiting respawn
  respawnTimer: number;         // seconds remaining; meaningful only while dead
  shuntVelocity: { x: number; z: number }; // decaying velocity term from being shunted by another cart — same shape as recoil, never applyImpulse
}
```

```ts
// src/sim/stats.ts (new — minimal, round-scoped; absorbed by round.ts later)
export interface Stats {
  shotsFired: number;   // cart-mode shots that actually spawned a ball (shot.hasBall was true)
  directHits: number;   // ball-vs-target or ball-vs-cart contacts resolved by combat.ts
  targetsDown: number;  // count of distinct Targets whose isDown flipped true
}

export function createStats(): Stats;
export function accuracy(s: Stats): number; // directHits / shotsFired, 0 when shotsFired === 0
```

```ts
// src/sim/combat.ts (new — the orchestrator; the only module that touches EventQueue)
export const DAMAGE_PER_MPS = /* tuned constant */;
export const MIN_HIT_DAMAGE = /* tuned constant */;
export const MAX_HIT_DAMAGE = /* tuned constant */;
export const SHUNT_DAMAGE_PER_MPS = /* tuned constant, cart-vs-cart */;

export function processContacts(
  eventQueue: RAPIER.EventQueue,
  ctx: { targets: Target[]; carts: Cart[]; stats: Stats },
): void;
```

## 4. Integration point

`Sim.create()` builds one `RAPIER.EventQueue` alongside the existing `RAPIER.World`, and enables
`RAPIER.ActiveEvents.COLLISION_EVENTS` on: every `Target` part collider, the cart collider, and
every ball collider (`Sim.ball`'s and each `BallPool` body's). `Sim.step()` calls
`world.step(eventQueue)` (Rapier's own step signature accepts the queue) immediately followed by
`combat.processContacts(eventQueue, { targets, carts, stats })`, before `eventQueue.clear()` for
the next tick. This sits in the same per-tick position `BallPool.step()`/bucket-checking already
occupy in `stepCart()`.

`combat.processContacts` dispatches by collider pair:
- **ball ↔ target part** → `target.knockDown(part, impulse)`, `stats.directHits += 1`, and (if
  this is the target's first knocked-down part) `stats.targetsDown += 1`.
- **ball ↔ cart** → damage from the ball's contact-point velocity (`DAMAGE_PER_MPS`, clamped to
  `[MIN_HIT_DAMAGE, MAX_HIT_DAMAGE]`), `applyDamage(cart.health, damage)`, `stats.directHits += 1`;
  a `true` (kill) return triggers §5.
- **cart ↔ cart** → `SHUNT_DAMAGE_PER_MPS`-scaled damage to both carts from their relative contact
  velocity, **and** a velocity term added to each cart's `shuntVelocity` (decayed the same way
  `Cart.recoil` already decays) — never an impulse, per §2's KCC constraint.

`stats.shotsFired` increments in `world.ts`'s existing cart-mode `resolveShot()`, at the same
point `cart.shot.hasBall` is already checked (Task 4 of the ammo plan) — a real ball spawning is
what "a shot fired" means for accuracy purposes, distinct from ammo's own decrement (which also
happens on a miss-producing 0-ammo blank).

## 5. Death → stroke penalty → respawn

On a killing `applyDamage` return for a cart:

```
Sim.strokes += 1                                    // same shape as the existing water-hazard penalty
cart.dead = true
cart.respawnTimer = RESPAWN_DELAY_S
```

While `cart.dead`, `stepCart()` ignores drive/steer/fire intent entirely (ammo, reload, and
position are frozen) and counts `respawnTimer` down by `FIXED_DT` each tick. On expiry:

```
cart.position = cartSpawnPosition(terrain)          // same spawn point a new hole already uses
cart.health = createHealth(STARTING_HP)             // full heal
cart.dead = false
```

`Sim.reset()` (new hole) also resets `cart.health` to full and `cart.dead = false` — a fresh hole
shouldn't carry forward battle damage. This differs from the ammo system's own `reset()` behavior
(left untouched, per the ammo plan's open question) — health resetting per-hole while ammo
persists is a deliberate, differently-scoped choice, not an inconsistency: ammo is a resource
economy meant to span a round, HP is a per-encounter stat that a new hole's fresh start resets.

## 6. Round stats (minimal tracker)

`Sim` owns one `readonly stats = createStats()`, populated per §4. It is **not** reset by
`Sim.reset()` — a round is a sequence of holes, and "direct hits" / "accuracy" read naturally as
round totals (matching how `ResultsScreen`'s nine-column layout, per `ROADMAP.md` Phase 1.75, is
meant to consume them once that phase resumes). `stats` is exposed as a plain readonly field for
now — no HUD or Results-screen consumer exists yet; this spec only makes the numbers real instead
of hardcoded zeros.

## 7. Error handling / edge cases

- **Multiple contacts in one drained batch:** `processContacts` iterates the queue once per tick
  and resolves each contact independently — no cross-contact state, matching how `BallPool.step`
  already treats each pooled ball independently.
- **A ball that knocks down a target and is later picked up as ammo:** no interaction. `knockDown`
  is a one-shot ragdoll flip; the ball's own `BallPool` lifecycle (flying → landed → pickup) is
  unaffected by what it hit on the way down.
- **Two simultaneous kills in one tick** (ball hit + shunt hit landing together, once a second
  cart exists): `applyDamage` is idempotent below zero (clamped), so a second kill-triggering call
  on an already-dead cart is a no-op — `cart.dead` is only set `true` if it wasn't already.
- **Respawn during `Sim.reset()`:** if a cart is mid-respawn-delay when a hole ends, `reset()`
  unconditionally clears `dead`/`respawnTimer` along with health — a new hole always starts alive.
- **Ball density raise** must be re-validated by running `npm run probe` and confirming Phase
  0/1.5 numbers are byte-for-byte unchanged, per `DECISIONS.md`'s own instruction — not assumed.
- **Cart-vs-cart shunting with no second cart in the live game:** exercised only by
  `combat.test.ts`'s synthetic second body (§8) until a second cart exists; this is accepted scope
  per §1, not a gap to silently paper over.

## 8. Testing (Vitest, colocated)

- `Target.test.ts` (new): a target dropped/at rest stays `Fixed` (no drift, matching
  `DECISIONS.md`'s "settles with no joint separation" criterion); a scripted impact flips the
  struck part (and, via joints, the connected rig) to `Dynamic` and sets `isDown`; no
  self-collision jitter between adjacent capsules over N steps; `reset()` returns to the held pose
  and `isDown = false`.
- `health.test.ts` (new, pure — no Rapier): `applyDamage` clamps `hp` at 0, never negative;
  returns `true` only on the 0-crossing tick, `false` on subsequent damage to an already-dead
  health; `heal` clamps at `max`.
- `combat.test.ts` (new): a synthetic `EventQueue` with a ball-vs-target-part contact calls
  `knockDown` and increments `stats.directHits`/`targetsDown` correctly (including the
  first-part-only `targetsDown` increment); a ball-vs-cart contact scales damage from the
  supplied contact velocity and clamps to `[MIN_HIT_DAMAGE, MAX_HIT_DAMAGE]`; a synthetic
  cart-vs-cart contact damages both sides and adds to `shuntVelocity` on both, never calling
  `applyImpulse`.
- `world.cart.test.ts` additions (integration): a cart driven to 0 HP takes a stroke penalty,
  `dead` becomes true, intent is ignored for `RESPAWN_DELAY_S`, then position snaps to
  `cartSpawnPosition` with health back at `STARTING_HP`; `Sim.reset()` clears `dead` and heals a
  mid-respawn cart.
- `stats.test.ts` (new): `accuracy` is `0` at `shotsFired === 0`; `directHits / shotsFired`
  otherwise; `stats` survives `Sim.reset()` unchanged (round-level persistence, per §6).
- Re-run `npm run probe` after the `BALL_DENSITY` change (§2/§7) and diff against the last known
  Phase 0/1.5 numbers — a required gate, not optional verification.

## 9. Open parameters for the implementation plan

`STARTING_HP = 100` and `RESPAWN_DELAY_S = 3` are placeholder-but-real starting values (not
user-specified), tunable by the implementation plan or by feel once played — same status
`POOL_SIZE = 32` had in the ammo spec. `DAMAGE_PER_MPS`, `MIN_HIT_DAMAGE`, `MAX_HIT_DAMAGE`, and
`SHUNT_DAMAGE_PER_MPS` are explicitly **not** set here; they need the ball's actual achievable
speed range (`Ballistics.ts`'s `CLUB_STATS` min/max speeds) as a reference point, which is
implementation-plan-level work, not a design-level guess. The exact capsule count within
`TARGET_CAPSULE_COUNT_RANGE` (7–11, per `DECISIONS.md`) is an implementation choice, not fixed
here.
