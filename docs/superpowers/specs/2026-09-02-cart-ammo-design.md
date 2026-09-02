# Cart Ammo and Pooled Combat Balls — Design

**Date:** 2 Sep 2026 · **Status:** approved, not yet implemented · **Roadmap slot:** Phase 3
(pulled forward of Phase 1.75 — see "Roadmap context" below)

Fulfils `docs/BACKLOG.md #16a` (Ammo per club) and the ammo half of `#24` (Food & drink cart
pickups — the bucket only; drink/hotdog are separate, unbuilt), and `docs/ROADMAP.md` Phase 3's
"Ammo as a real resource" checklist item (~line 309).

## Roadmap context

The project's default next phase was 1.75 (app shell, screens, par-per-hole scorecard). The
user has redirected: STROKE mode (traditional scored round) stays a real future destination —
it is not being cut — but combat gameplay (shooting other carts) is the priority right now, and
Phase 1.75's scorecard has no audience without it. This spec is scoped to cart-mode combat
firing only; it does not touch stationary/STROKE mode's ball model.

## 1. Decision

Cart mode gets its own **pooled multi-ball system** for combat shots, separate from the
existing single-ball model that stationary/STROKE mode keeps using unchanged. A fixed pool of
ball rigid bodies is drawn from an **ammo counter** on each `Cart`, replenished by pickups.

Why a fork rather than one unified ball model: the existing single `Sim.ball` singleton
(`src/sim/world.ts`) carries hazard-reset, hole-out detection, and stroke-and-distance rules
that only make sense when there's a cup to sink a ball into. Combat shots have no cup — they
fly, land, and either get reused as ammo or despawn. Threading ammo/pooling through hole-out
logic that doesn't apply would tangle two unrelated rule sets. Keeping them separate means
STROKE mode's future is untouched by this work.

**Explicitly out of scope for this spec** (deliberate simplifications, not oversights):
- Rendering: the barrel visually showing a loaded ball, the HUD ammo counter, pickup glow-
  cylinder geometry. This project's established pattern lands sim logic (testable headlessly)
  before render/HUD work touches it — see how terrain/surfaces/cart physics all shipped this
  way. Rendering is explicit follow-up, tracked separately.
- Per-club ammo. `UI-SPEC.md`'s H7 row names `Cart.ammo[club]` (per-club counts) as the original
  concept; this spec uses **one shared pool per cart** instead, per explicit user simplification
  ("upgrades will come later"). If per-club ammo is wanted later, it's an additive change on top
  of this (split one counter into a per-`ClubType` record) — not a redesign.
- Mode-scoping infrastructure (`BACKLOG.md #20b`). Cart mode always fires from the ammo pool
  now; there is no STROKE/CTF/TARGETS switch yet. That switch is separate, later work — when it
  lands, "ammo disabled" for STROKE mode becomes one of its cases.
- Course-scale bucket placement/distribution. See "Bucket placement" below.

## 2. Current state (grounding facts)

- Exactly one physical ball rigid body exists today: `Sim.ball` in `src/sim/world.ts`, shared by
  both modes.
- Cart mode currently requires driving over the single resting ball to "load" it —
  `ballLoaded = driving && ballInReach && isResting() && !holedOut` (`world.ts` ~line 388) — and
  this is **not sticky**: moving off the ball drops the loaded state on the next tick.
- `Cart.fire()` (`src/sim/entities/Cart.ts`) always recoils regardless of whether a ball is
  loaded. `world.ts`'s `resolveShot()` (~line 444) decides blank-vs-real-shot by checking
  `ballLoaded` (cart mode) or `isResting() && !holedOut` (stationary mode), and only then
  teleports the ball to the muzzle and launches it.
- `PICKUP_RANGE` already exists in `world.ts` as the resting-ball pickup radius; reuse it for
  the landed-ball-as-ammo pickup range rather than defining a second constant.

## 3. Data model

```ts
// src/sim/entities/Cart.ts additions
export const STARTING_AMMO = 30;
export const BUCKET_REFILL_AMMO = 30;
export const MAX_AMMO = 100;

class Cart {
  ammo: number;                    // starts at STARTING_AMMO, clamped to [0, MAX_AMMO]
  addAmmo(n: number): void;        // clamps the result to MAX_AMMO
}

interface CartShot {
  fired: boolean;
  hasBall: boolean;                // NEW: true if this shot should spawn a ball (ammo was available)
  club: ClubType;
  charge01: number;
  yaw: number;
}
```

`fire()`'s existing `canFire`/reload guard is unchanged. The new ammo check is orthogonal: on a
successful fire, if `ammo > 0`, decrement it and set `shot.hasBall = true`; if `ammo === 0`, set
`shot.hasBall = false` — this is the existing blank-fire (recoil-only, no ball) path, now
triggered by `ammo === 0` instead of the caller checking `ballLoaded`.

```ts
// src/sim/entities/BallPool.ts (new)
type BallState = "idle" | "flying" | "landed";

interface PooledBall {
  body: RAPIER.RigidBody;
  state: BallState;
  landedAt: number;                // sim-time seconds; meaningful only when state === "landed"
}

const POOL_SIZE = 32;
const LANDED_BALL_DESPAWN_S = 15;

class BallPool {
  acquire(): PooledBall;           // idle -> flying; force-recycles the oldest "landed" ball if none idle
  release(ball: PooledBall): void; // -> idle, teleported off-world (out of the playable field, collider disabled)
  step(dt: number, simTime: number): void; // flying -> landed on rest (reuses the existing isGrounded-style check); landed -> idle after LANDED_BALL_DESPAWN_S
  ballsNear(x: number, z: number, radius: number): PooledBall[]; // "landed" balls only, for pickup checks
}
```

```ts
// src/sim/entities/Pickup.ts (new)
interface Bucket {
  position: Vec2XZ;
  cooldownRemaining: number;       // seconds until respawn after being taken; starts at 0 (available)
}
const BUCKET_COOLDOWN_S = 60;
const BUCKET_PICKUP_RANGE = PICKUP_RANGE; // reuse world.ts's existing constant, not a new one
```

## 4. Integration point

`world.ts`'s `resolveShot()` cart-mode branch changes from checking `ballLoaded` to checking
`cart.shot.hasBall`. On a real shot: `ballPool.acquire()`, position the returned body at the
muzzle (reusing the existing `computeMuzzle`/`moveBallToMuzzle` pattern, generalized to take a
target body instead of always writing to `this.ball`), then launch it with the existing
`launch()` velocity math. The stationary-mode branch, and everything in `world.ts` that only
stationary mode uses (`current`/`previous` transform tracking, `surfaceUnderBall`, `restTicks`,
`holedOut`, hazard reset), is untouched.

Each tick: `ballPool.step(dt, simTime)` runs alongside existing per-tick logic. Bucket proximity
is checked the same way `ballInReach` is checked today — cart position vs. each bucket's
position, within `BUCKET_PICKUP_RANGE`. Landed-ball proximity uses `ballPool.ballsNear()`.

## 5. Data flow (one combat shot)

```
intent.fire held -> Cart.stepSwing() charges -> release edge -> Cart.fire(charge01)
  -> reload check (existing) -> ammo check (new)
     ammo > 0:  decrement ammo, shot.hasBall = true,  recoil applied (existing)
     ammo == 0: shot.hasBall = false,                 recoil applied (existing, unchanged blank-fire)
-> world.ts resolveShot(): if shot.hasBall, ballPool.acquire() -> position at muzzle -> launch()
   ball.state: flying
-> ball lands (rest check) -> state: landed, landedAt = simTime
   -> within 15s: any cart within BUCKET_PICKUP_RANGE picks it up -> +1 ammo (capped at MAX_AMMO) -> state: idle
   -> after 15s with no pickup: state: idle (despawned)
```

Bucket flow is independent and simpler: cart within `BUCKET_PICKUP_RANGE` of an
available (`cooldownRemaining <= 0`) bucket -> `cart.addAmmo(BUCKET_REFILL_AMMO)` (capped at
`MAX_AMMO`, still consumes the bucket even if already at cap) -> bucket's
`cooldownRemaining = BUCKET_COOLDOWN_S`, ticking down each frame.

## 6. Error handling / edge cases

- **Pool exhaustion:** if `acquire()` finds no `idle` body, it force-recycles the **oldest
  `landed`** ball (never an oldest `flying` one — an in-flight shot must never vanish mid-arc).
  If even that's impossible (all 32 bodies `flying` simultaneously — an extreme, likely
  untestable-in-practice case), the shot degrades to a blank: recoil fires, but ammo is **not**
  consumed and no ball spawns. Matches this codebase's general "degrade gracefully, never throw
  from the hot path" posture.
- **Ammo cannot go negative:** `fire()` checks `ammo > 0` before decrementing, the same guard
  shape as the existing `canFire`/`reload` check.
- **Bucket picked up at `MAX_AMMO` already:** no-op on ammo (stays at 100), but the bucket still
  consumes/respawns on its cooldown — a full cart shouldn't be able to "reserve" a bucket for
  later by leaving it untouched, since a future multi-cart course makes that a griefing vector.
- **Landed ball picked up by a different cart than the shooter:** allowed. Ammo pickups are
  cart-agnostic — matches how the bucket already works, and is more interesting combat (denying
  or stealing an opponent's spent ammo).
- **Two carts converge on the same landed ball / bucket the same tick:** first-checked-wins by
  iteration order — single-threaded per tick, no real race, consistent with how `ballInReach` is
  resolved today.

## 7. Bucket placement (this spec: one bucket, hardcoded)

For now, exactly **one** bucket exists, at a fixed test position, for verifying the mechanic
works. Scattering buckets across a real course needs a larger map than currently exists — this
project is 9 holes today, 18 later, built from the research in `docs/RESEARCH-TERRAIN.md`/the
procedural course generator (`src/sim/course.ts`). Bucket placement is **not** part of this
spec.

**Forward note for whoever builds the full course map:** when that work starts, add a
placement-validity check for range-ball bucket spawn points — analogous to `course.ts`'s seven
playability checks (e.g. `validateHole`) — rather than scattering buckets blind. What "valid"
means (reachable, not in water, spaced from tee/green, etc.) is that future work's decision to
make, not this spec's. Recorded here so it isn't lost; a `BACKLOG.md` row should be added
alongside the map-scale work when it's scoped.

## 8. Testing (Vitest, colocated; no Rapier needed for pure ammo/pool bookkeeping)

- `Cart.test.ts` additions: ammo starts at `STARTING_AMMO`; `addAmmo` clamps at `MAX_AMMO`
  (including from a value already near the cap, e.g. 90 + 30 -> 100, not 120); `fire()`
  decrements ammo by 1 on a real shot and sets `shot.hasBall = true`; `fire()` at `ammo === 0`
  leaves ammo at 0, sets `shot.hasBall = false`, and still applies recoil (existing blank-fire
  behavior preserved).
- `BallPool.test.ts` (new): `acquire()` returns a distinct idle body each call up to `POOL_SIZE`;
  the `POOL_SIZE + 1`th `acquire()` recycles the oldest `landed` body, never a `flying` one;
  `release()` returns a body to `idle`; `step()` transitions `flying -> landed` on rest and
  `landed -> idle` after exactly `LANDED_BALL_DESPAWN_S`, not before.
- `Pickup.test.ts` (new): bucket at `cooldownRemaining <= 0` grants ammo within range, does
  nothing outside range; picking up while at `MAX_AMMO` still starts the cooldown; bucket is
  unavailable until `cooldownRemaining` reaches 0 after `BUCKET_COOLDOWN_S`; a landed ball grants
  +1 ammo within its 15s window and is a no-op once despawned (state `idle`).
- `world.cart.test.ts` extension (integration): a scripted fire sequence with cart mode's new
  ammo-aware `resolveShot()` spawns a ball from the pool at the correct muzzle position; firing
  at 0 ammo produces the recoil-only blank (no new ball body enters `flying` state); stationary
  mode's existing tests are unaffected (regression check that the fork didn't leak state across
  modes).

## 9. Open parameters for the implementation plan

Two numbers are set here from user decisions and are not tunable-by-feel placeholders:
`STARTING_AMMO = 30`, `BUCKET_REFILL_AMMO = 30`, `MAX_AMMO = 100`, `LANDED_BALL_DESPAWN_S = 15`,
`BUCKET_COOLDOWN_S = 60`. `POOL_SIZE = 32` is an engineering estimate (bounded by realistic
simultaneous in-flight + 15s-landed balls across a small number of carts), not a user-specified
value — the implementation plan or its own testing may adjust it if 32 proves too small or
wastefully large once real play data exists.
