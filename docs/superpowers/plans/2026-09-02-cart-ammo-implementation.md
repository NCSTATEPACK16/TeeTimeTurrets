# Cart Ammo and Pooled Combat Balls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give cart mode its own ammo-gated, pooled multi-ball combat system (fire from an ammo counter, ball flies/lands/becomes pickup ammo, buckets refill the counter), completely forked from stationary/STROKE mode's existing single-ball model.

**Architecture:** Three new/extended sim-layer modules — ammo on `Cart`, a `BallPool` managing up to 32 pooled Rapier ball bodies through an `idle → flying → landed` state machine, and a `Pickup` module for the hardcoded refill bucket — wired into `world.ts`'s `resolveShot()`/`stepCart()` alongside, not inside, the untouched stationary-mode code path. Sim-only: no rendering, HUD, or glow-cylinder work.

**Tech Stack:** TypeScript, Vitest (colocated `*.test.ts`), `@dimforge/rapier3d-compat` (already a dependency).

**Spec:** `docs/superpowers/specs/2026-09-02-cart-ammo-design.md` — read it alongside this plan; this plan argues from it and does not restate its rationale.

## Global Constraints

- `STARTING_AMMO = 30`, `BUCKET_REFILL_AMMO = 30`, `MAX_AMMO = 100` (Cart.ts).
- `POOL_SIZE = 32`, `LANDED_BALL_DESPAWN_S = 15` (BallPool.ts).
- `BUCKET_COOLDOWN_S = 60` (Pickup.ts).
- Reuse `world.ts`'s existing `PICKUP_RANGE = 3.0` for both bucket and landed-ball pickup range — never define a second range constant.
- One shared ammo pool per cart, not per-club.
- Cart mode's ball state is 100% forked from stationary mode: `Sim.ball`, `current`/`previous`, `surfaceUnderBall`, `restTicks`, `holedOut`, hazard/water reset, and `strokes` are stationary-mode-only and must not be touched by any task in this plan.
- No rendering, HUD, or glow-cylinder work — sim logic only.

---

## File Structure

- **Modify `src/sim/entities/Cart.ts`** — ammo state (`ammo`, `addAmmo`), `CartShot.hasBall`, ammo gating in `fire()`.
- **Modify `src/sim/entities/Cart.test.ts`** — ammo test coverage.
- **Create `src/sim/entities/BallPool.ts`** — the pooled-ball state machine (`idle`/`flying`/`landed`) and the Rapier bodies backing it.
- **Create `src/sim/entities/BallPool.test.ts`** — pool acquire/release/step/proximity coverage.
- **Create `src/sim/entities/Pickup.ts`** — the `Bucket` type and its pure cooldown/pickup logic.
- **Create `src/sim/entities/Pickup.test.ts`** — bucket cooldown/range coverage.
- **Modify `src/sim/world.ts`** — own a `BallPool` and the (one, hardcoded) `Bucket`; cart-mode branch of `resolveShot()` forks onto the pool instead of `this.ball`; `stepCart()` ticks the pool/bucket and applies pickups.
- **Modify `src/sim/world.cart.test.ts`** — integration coverage for the ammo-aware cart-mode fire path.
- **Modify `docs/ROADMAP.md`, `docs/BACKLOG.md`** — cross-reference the new spec from the backlog rows it fulfils (#16a, #24) and note the Phase 1.75 deprioritization, per the outstanding item in the prior session's handoff.

**Two deliberate departures from the spec's illustrative code sketches, both needed to keep `BallPool.ts` and `Pickup.ts` as leaf modules with no import back into `world.ts` (avoiding a `world.ts ⇄ BallPool.ts`/`Pickup.ts` circular import):**

1. `BallPool.acquire()` returns `PooledBall | null`, not a bare `PooledBall`. The spec's own error-handling section requires a "no ball spawns" outcome when all 32 bodies are simultaneously `flying`; the sketch's non-null signature doesn't leave room for that outcome, so the plan resolves it as `null`. `world.ts` handles `null` by refunding the ammo `Cart.fire()` already spent (see Task 4).
2. `Pickup.ts` does not import `PICKUP_RANGE` from `world.ts`. Instead its pickup function takes `range: number` as a parameter, and `world.ts` (which already owns `PICKUP_RANGE`) passes it in at the call site. Same constant, same "don't define a second one" outcome the spec asks for, without the circular import its `const BUCKET_PICKUP_RANGE = PICKUP_RANGE;` sketch would create once `world.ts` also needs to import `Bucket` from `Pickup.ts`.

`BallPool.ts` also duplicates six ball-physics tuning numbers (radius, density, friction, restitution, linear/angular damping) that already exist as private constants in `world.ts`, for the same leaf-module reason — `world.ts` can't export them to `BallPool.ts` without `BallPool.ts` importing `world.ts`. Each duplicated constant carries a comment naming its `world.ts` counterpart so a future tuning pass doesn't update one and miss the other.

---

## Task 1: Cart ammo state and fire() gating

**Files:**
- Modify: `src/sim/entities/Cart.ts`
- Test: `src/sim/entities/Cart.test.ts`

**Interfaces:**
- Produces: `STARTING_AMMO`, `BUCKET_REFILL_AMMO`, `MAX_AMMO` (exported `number` constants); `Cart.ammo: number`; `Cart.addAmmo(n: number): void`; `CartShot.hasBall: boolean`.

- [ ] **Step 1: Write the failing tests**

Add to `src/sim/entities/Cart.test.ts`. First update its import line to pull in the new exports:

```ts
import { CART_COLLIDER, CART_TUNING, Cart, MAX_AMMO, STARTING_AMMO, TireType, computeMuzzle } from "./Cart";
```

Then append a new describe block at the end of the file:

```ts
describe("Cart ammo", () => {
  let cart: Cart;
  beforeEach(() => {
    cart = new Cart();
  });

  it("starts at STARTING_AMMO", () => {
    expect(cart.ammo).toBe(STARTING_AMMO);
  });

  it("addAmmo clamps at MAX_AMMO", () => {
    cart.addAmmo(MAX_AMMO);
    expect(cart.ammo).toBe(MAX_AMMO);
  });

  it("addAmmo clamps a near-cap value rather than overshooting", () => {
    cart.ammo = 90;
    cart.addAmmo(30);
    expect(cart.ammo).toBe(100);
  });

  it("fire() decrements ammo by 1 and sets shot.hasBall on a real shot", () => {
    cart.fire(1);
    expect(cart.ammo).toBe(STARTING_AMMO - 1);
    expect(cart.shot.hasBall).toBe(true);
  });

  it("fire() at 0 ammo leaves ammo at 0, sets hasBall false, and still recoils", () => {
    cart.ammo = 0;
    const before = { x: cart.recoil.x, z: cart.recoil.z };
    cart.fire(1);
    expect(cart.ammo).toBe(0);
    expect(cart.shot.hasBall).toBe(false);
    expect(cart.recoil.x).not.toBeCloseTo(before.x, 9);
  });

  it("fire() while reloading does not touch ammo or hasBall", () => {
    cart.fire(1);
    const ammoAfterFirstShot = cart.ammo;
    const fired = cart.fire(1);
    expect(fired).toBe(false);
    expect(cart.ammo).toBe(ammoAfterFirstShot);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/sim/entities/Cart.test.ts`
Expected: FAIL — `STARTING_AMMO`/`MAX_AMMO` are not exported from `./Cart`, `cart.ammo` and `cart.shot.hasBall` are `undefined`.

- [ ] **Step 3: Implement ammo in Cart.ts**

Add the three exported constants near the top of the file, alongside the existing `TIRE_TUNING`/`CART_COLLIDER`-style constant block (after the imports, before `TireType`):

```ts
export const STARTING_AMMO = 30;
export const BUCKET_REFILL_AMMO = 30;
export const MAX_AMMO = 100;
```

Extend `CartShot`:

```ts
interface CartShot {
  fired: boolean;
  hasBall: boolean;
  club: ClubType;
  charge01: number;
  yaw: number;
}
```

In the `Cart` class, add the field next to the other public fields (after `readonly shot: CartShot;`):

```ts
  ammo: number;
```

Initialize it in the constructor, and add `hasBall: false` to the existing `shot` initializer:

```ts
  constructor(options: CartOptions = {}) {
    const start = options.position ?? { x: 0, y: 0, z: 0 };
    this.position = { x: start.x, y: start.y, z: start.z };
    this.heading = options.heading ?? 0;
    this.turretOffset = options.turretOffset ?? 0;
    this.speed = 0;
    this.tire = options.tire ?? TireType.Street;
    this.club = options.club ?? ClubType.Driver;
    this.recoil = { x: 0, z: 0 };
    this.desiredTranslation = { x: 0, y: 0, z: 0 };
    this.ammo = STARTING_AMMO;
    this.shot = { fired: false, hasBall: false, club: this.club, charge01: 0, yaw: 0 };
  }
```

Add `addAmmo` next to `selectClub`:

```ts
  /** Clamps to MAX_AMMO. Used by bucket refills and landed-ball pickups alike. */
  addAmmo(n: number): void {
    this.ammo = Math.min(MAX_AMMO, this.ammo + n);
  }
```

Update `fire()` to gate ammo. The ammo check is orthogonal to the existing `canFire`/reload guard — it runs after that guard has already returned `false`-and-done for a still-reloading cart:

```ts
  fire(charge01: number): boolean {
    if (!this.canFire) return false;

    const stats = CLUB_STATS[this.club];
    const charge = clamp01(charge01);
    const launchSpeed = stats.minSpeed + (stats.maxSpeed - stats.minSpeed) * charge;
    const kick = launchSpeed * CART_TUNING.recoilCoefficient;

    this.recoil.x -= Math.cos(this.turretYaw) * kick;
    this.recoil.z -= Math.sin(this.turretYaw) * kick;

    this.reload = stats.reloadSeconds;
    this.chargeHeld = 0;

    const hasBall = this.ammo > 0;
    if (hasBall) this.ammo -= 1;

    this.shot.fired = true;
    this.shot.hasBall = hasBall;
    this.shot.club = this.club;
    this.shot.charge01 = charge;
    this.shot.yaw = this.turretYaw;
    return true;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/sim/entities/Cart.test.ts`
Expected: PASS, all tests including the pre-existing ones in the file.

- [ ] **Step 5: Commit**

```bash
git add src/sim/entities/Cart.ts src/sim/entities/Cart.test.ts
git commit -m "feat(cart): add ammo counter and hasBall gating to fire()"
```

---

## Task 2: BallPool — pooled ball state machine

**Files:**
- Create: `src/sim/entities/BallPool.ts`
- Test: `src/sim/entities/BallPool.test.ts`

**Interfaces:**
- Consumes: `heightAt(x, z): number` from `../terrain` (already used by `world.ts`'s `isGrounded()` — same pattern).
- Produces: `type BallState = "idle" | "flying" | "landed"`; `interface PooledBall { body: RAPIER.RigidBody; state: BallState; landedAt: number }`; `POOL_SIZE`, `LANDED_BALL_DESPAWN_S` (exported constants); `class BallPool` with `constructor(world: RAPIER.World, poolSize?: number)`, `acquire(): PooledBall | null`, `release(ball: PooledBall): void`, `step(dt: number, simTime: number): void`, `ballsNear(x: number, z: number, radius: number): PooledBall[]`.

- [ ] **Step 1: Write the failing tests**

Create `src/sim/entities/BallPool.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { heightAt } from "../terrain";
import { BallPool, LANDED_BALL_DESPAWN_S, POOL_SIZE } from "./BallPool";

const DT = 1 / 60;

describe("BallPool", () => {
  let world: RAPIER.World;
  let pool: BallPool;

  beforeEach(async () => {
    await RAPIER.init();
    world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    pool = new BallPool(world);
  });

  it("acquire returns a distinct idle body each call up to POOL_SIZE", () => {
    const seen = new Set<RAPIER.RigidBody>();
    for (let i = 0; i < POOL_SIZE; i++) {
      const ball = pool.acquire();
      expect(ball).not.toBeNull();
      expect(seen.has(ball!.body)).toBe(false);
      seen.add(ball!.body);
      expect(ball!.state).toBe("flying");
    }
  });

  it("the (POOL_SIZE + 1)th acquire recycles the oldest landed body, never a flying one", () => {
    const first = pool.acquire()!;
    first.state = "landed";
    first.landedAt = 0;
    for (let i = 1; i < POOL_SIZE; i++) pool.acquire();

    const recycled = pool.acquire();
    expect(recycled).not.toBeNull();
    expect(recycled!.body).toBe(first.body);
    expect(recycled!.state).toBe("flying");
  });

  it("acquire returns null when every body is flying (never recycles a flying ball)", () => {
    for (let i = 0; i < POOL_SIZE; i++) pool.acquire();
    expect(pool.acquire()).toBeNull();
  });

  it("release() returns a body to idle", () => {
    const ball = pool.acquire()!;
    pool.release(ball);
    expect(ball.state).toBe("idle");
  });

  it("step() transitions flying -> landed after sustained rest on the ground", () => {
    const ball = pool.acquire()!;
    const groundY = heightAt(0, 0);
    ball.body.setTranslation({ x: 0, y: groundY + 0.1, z: 0 }, true);
    ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true);

    for (let i = 0; i < 11; i++) pool.step(DT, i * DT);
    expect(ball.state).toBe("flying");

    pool.step(DT, 11 * DT);
    expect(ball.state).toBe("landed");
  });

  it("step() does not land a ball that is still moving fast", () => {
    const ball = pool.acquire()!;
    const groundY = heightAt(0, 0);
    ball.body.setTranslation({ x: 0, y: groundY + 0.1, z: 0 }, true);
    ball.body.setLinvel({ x: 5, y: 0, z: 0 }, true);

    for (let i = 0; i < 20; i++) pool.step(DT, i * DT);
    expect(ball.state).toBe("flying");
  });

  it("step() transitions landed -> idle after exactly LANDED_BALL_DESPAWN_S, not before", () => {
    const ball = pool.acquire()!;
    ball.state = "landed";
    ball.landedAt = 0;

    pool.step(DT, LANDED_BALL_DESPAWN_S - 0.001);
    expect(ball.state).toBe("landed");

    pool.step(DT, LANDED_BALL_DESPAWN_S);
    expect(ball.state).toBe("idle");
  });

  it("ballsNear returns only landed balls within range", () => {
    const landed = pool.acquire()!;
    landed.state = "landed";
    landed.body.setTranslation({ x: 5, y: 0, z: 5 }, true);

    const flying = pool.acquire()!;
    flying.body.setTranslation({ x: 5, y: 0, z: 5 }, true);

    const near = pool.ballsNear(5, 5, 1);
    expect(near).toHaveLength(1);
    expect(near[0].body).toBe(landed.body);
    expect(pool.ballsNear(50, 50, 1)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/sim/entities/BallPool.test.ts`
Expected: FAIL — `./BallPool` does not exist yet.

- [ ] **Step 3: Implement BallPool.ts**

Create `src/sim/entities/BallPool.ts`:

```ts
import RAPIER from "@dimforge/rapier3d-compat";
import { heightAt } from "../terrain";

/** Sim-only pooled combat balls for cart mode. No render/HUD concerns here — see the spec's
 * explicit out-of-scope list (docs/superpowers/specs/2026-09-02-cart-ammo-design.md §1). */

export type BallState = "idle" | "flying" | "landed";

export interface PooledBall {
  body: RAPIER.RigidBody;
  state: BallState;
  landedAt: number;
}

export const POOL_SIZE = 32;
export const LANDED_BALL_DESPAWN_S = 15;

// Mirrors world.ts's BALL_RADIUS/BALL_DENSITY/etc. Duplicated rather than imported so this
// file stays a leaf module -- world.ts imports BallPool, so BallPool importing back from
// world.ts would be circular. Keep these in sync if the stationary ball's tuning changes.
const POOLED_BALL_RADIUS = 0.15;
const POOLED_BALL_DENSITY = 1130;
const POOLED_BALL_FRICTION = 0.55;
const POOLED_BALL_RESTITUTION = 0.35;
const POOLED_BALL_LINEAR_DAMPING = 0.05;
const POOLED_BALL_ANGULAR_DAMPING = 0.6;

// Mirrors world.ts's REST_SPEED_THRESHOLD/REST_HOLD_TICKS -- same duplication reason above.
const REST_SPEED_THRESHOLD = 0.25;
const REST_HOLD_TICKS = 12;

/** Well outside the playable field (FIELD_SIZE is 160, so +/-80 on each axis) and far below
 * OUT_OF_BOUNDS_Y, so a parked idle ball can never be mistaken for a live one by any bounds
 * or height check. */
const PARKED_POSITION = { x: 0, y: -1000, z: 0 };

export class BallPool {
  private readonly balls: PooledBall[];
  private readonly restTicks = new WeakMap<RAPIER.RigidBody, number>();

  constructor(world: RAPIER.World, poolSize: number = POOL_SIZE) {
    this.balls = [];
    for (let i = 0; i < poolSize; i++) {
      const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(PARKED_POSITION.x, PARKED_POSITION.y, PARKED_POSITION.z)
        .setCcdEnabled(true)
        .setLinearDamping(POOLED_BALL_LINEAR_DAMPING)
        .setAngularDamping(POOLED_BALL_ANGULAR_DAMPING);
      const body = world.createRigidBody(bodyDesc);

      const colliderDesc = RAPIER.ColliderDesc.ball(POOLED_BALL_RADIUS)
        .setDensity(POOLED_BALL_DENSITY)
        .setFriction(POOLED_BALL_FRICTION)
        .setRestitution(POOLED_BALL_RESTITUTION)
        .setEnabled(false);
      world.createCollider(colliderDesc, body);

      this.balls.push({ body, state: "idle", landedAt: 0 });
      this.restTicks.set(body, 0);
    }
  }

  /**
   * idle -> flying. Force-recycles the oldest `landed` ball if no `idle` body remains (never a
   * `flying` one -- an in-flight shot must never vanish mid-arc). Returns null only when every
   * pooled body is simultaneously `flying`; the caller must degrade to a blank shot in that case.
   */
  acquire(): PooledBall | null {
    const idle = this.balls.find((b) => b.state === "idle");
    if (idle) return this.beginFlight(idle);

    const landed = this.balls.filter((b) => b.state === "landed");
    if (landed.length === 0) return null;
    let oldest = landed[0];
    for (const b of landed) if (b.landedAt < oldest.landedAt) oldest = b;
    return this.beginFlight(oldest);
  }

  private beginFlight(ball: PooledBall): PooledBall {
    ball.state = "flying";
    ball.body.collider(0).setEnabled(true);
    this.restTicks.set(ball.body, 0);
    return ball;
  }

  /** -> idle, teleported off-world with its collider disabled. */
  release(ball: PooledBall): void {
    ball.state = "idle";
    ball.body.setTranslation(PARKED_POSITION, true);
    ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    ball.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    ball.body.collider(0).setEnabled(false);
    this.restTicks.set(ball.body, 0);
  }

  /** flying -> landed on sustained rest (mirrors world.ts's isGrounded/restTicks pattern);
   * landed -> idle after LANDED_BALL_DESPAWN_S with no pickup. */
  step(dt: number, simTime: number): void {
    for (const ball of this.balls) {
      if (ball.state === "flying") {
        const t = ball.body.translation();
        const v = ball.body.linvel();
        const grounded = t.y - heightAt(t.x, t.z) < POOLED_BALL_RADIUS * 2;
        const slow = Math.hypot(v.x, v.y, v.z) < REST_SPEED_THRESHOLD;
        const ticks = grounded && slow ? (this.restTicks.get(ball.body) ?? 0) + 1 : 0;
        this.restTicks.set(ball.body, ticks);
        if (ticks >= REST_HOLD_TICKS) {
          ball.state = "landed";
          ball.landedAt = simTime;
        }
      } else if (ball.state === "landed") {
        if (simTime - ball.landedAt >= LANDED_BALL_DESPAWN_S) {
          this.release(ball);
        }
      }
    }
  }

  /** "landed" balls only, for pickup checks. */
  ballsNear(x: number, z: number, radius: number): PooledBall[] {
    return this.balls.filter((b) => {
      if (b.state !== "landed") return false;
      const t = b.body.translation();
      return Math.hypot(t.x - x, t.z - z) <= radius;
    });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/sim/entities/BallPool.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/entities/BallPool.ts src/sim/entities/BallPool.test.ts
git commit -m "feat(sim): add pooled multi-ball state machine for cart-mode combat"
```

---

## Task 3: Pickup — refill bucket

**Files:**
- Create: `src/sim/entities/Pickup.ts`
- Test: `src/sim/entities/Pickup.test.ts`

**Interfaces:**
- Produces: `interface Bucket { position: { x: number; z: number }; cooldownRemaining: number }`; `BUCKET_COOLDOWN_S` (exported constant); `createBucket(x: number, z: number): Bucket`; `stepBucket(bucket: Bucket, dt: number): void`; `tryTakeBucket(bucket: Bucket, cartX: number, cartZ: number, range: number): boolean`.

- [ ] **Step 1: Write the failing tests**

Create `src/sim/entities/Pickup.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BUCKET_COOLDOWN_S, createBucket, stepBucket, tryTakeBucket } from "./Pickup";

describe("Bucket pickup", () => {
  it("grants a take within range when off cooldown, and starts the cooldown", () => {
    const bucket = createBucket(0, 0);
    expect(tryTakeBucket(bucket, 1, 0, 3)).toBe(true);
    expect(bucket.cooldownRemaining).toBe(BUCKET_COOLDOWN_S);
  });

  it("does nothing outside range", () => {
    const bucket = createBucket(0, 0);
    expect(tryTakeBucket(bucket, 10, 0, 3)).toBe(false);
    expect(bucket.cooldownRemaining).toBe(0);
  });

  it("is unavailable immediately after being taken, even in range", () => {
    const bucket = createBucket(0, 0);
    tryTakeBucket(bucket, 0, 0, 3);
    expect(tryTakeBucket(bucket, 0, 0, 3)).toBe(false);
  });

  it("becomes available again only after BUCKET_COOLDOWN_S of stepBucket", () => {
    const bucket = createBucket(0, 0);
    tryTakeBucket(bucket, 0, 0, 3);

    for (let i = 0; i < BUCKET_COOLDOWN_S - 1; i++) stepBucket(bucket, 1);
    expect(tryTakeBucket(bucket, 0, 0, 3)).toBe(false);

    stepBucket(bucket, 1);
    expect(bucket.cooldownRemaining).toBe(0);
    expect(tryTakeBucket(bucket, 0, 0, 3)).toBe(true);
  });

  it("stepBucket never drives cooldownRemaining negative", () => {
    const bucket = createBucket(0, 0);
    stepBucket(bucket, 1);
    expect(bucket.cooldownRemaining).toBe(0);
  });
});
```

Note: whether a full cart should still consume/restart the bucket's cooldown is the *caller's*
concern (`world.ts` decides whether to call `cart.addAmmo()` after a successful take) —
`tryTakeBucket()` itself always starts the cooldown on any valid take, which is what "still
consumes the bucket even at MAX_AMMO" (spec §6) requires from this module.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/sim/entities/Pickup.test.ts`
Expected: FAIL — `./Pickup` does not exist yet.

- [ ] **Step 3: Implement Pickup.ts**

Create `src/sim/entities/Pickup.ts`:

```ts
/** Sim-only refill bucket for cart-mode combat. See docs/superpowers/specs/2026-09-02-cart-ammo-design.md §7
 * for why bucket placement is hardcoded to a single test position for now. */

export interface Bucket {
  position: { x: number; z: number };
  cooldownRemaining: number;
}

export const BUCKET_COOLDOWN_S = 60;

export function createBucket(x: number, z: number): Bucket {
  return { position: { x, z }, cooldownRemaining: 0 };
}

export function stepBucket(bucket: Bucket, dt: number): void {
  if (bucket.cooldownRemaining > 0) {
    bucket.cooldownRemaining = Math.max(0, bucket.cooldownRemaining - dt);
  }
}

/**
 * Returns true if the bucket was taken (cart in range, bucket off cooldown), and starts its
 * cooldown in that case. Does not grant ammo itself -- the caller (world.ts) decides that, so
 * that "still consumes the bucket even at MAX_AMMO" is the caller's clamp-and-consume choice,
 * not this module's.
 */
export function tryTakeBucket(bucket: Bucket, cartX: number, cartZ: number, range: number): boolean {
  if (bucket.cooldownRemaining > 0) return false;
  const dist = Math.hypot(bucket.position.x - cartX, bucket.position.z - cartZ);
  if (dist > range) return false;
  bucket.cooldownRemaining = BUCKET_COOLDOWN_S;
  return true;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/sim/entities/Pickup.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/entities/Pickup.ts src/sim/entities/Pickup.test.ts
git commit -m "feat(sim): add refill bucket pickup logic"
```

---

## Task 4: Wire BallPool/Pickup into world.ts

**Files:**
- Modify: `src/sim/world.ts`
- Test: `src/sim/world.cart.test.ts`

**Interfaces:**
- Consumes: `BallPool`/`PooledBall` (Task 2), `Bucket`/`createBucket`/`stepBucket`/`tryTakeBucket` (Task 3), `STARTING_AMMO`/`BUCKET_REFILL_AMMO`/`MAX_AMMO`/`CartShot.hasBall`/`Cart.ammo`/`Cart.addAmmo` (Task 1).
- Produces: `Sim.ammo` is *not* added — `Sim.cart.ammo` is already the read path (the cart owns its own ammo; `Sim` does not duplicate it). `Sim`'s cart-mode `resolveShot()` no longer reads `this.ballLoaded`.

- [ ] **Step 1: Write the failing integration tests**

Append to `src/sim/world.cart.test.ts`:

```ts
describe("cart-mode ammo-aware combat shots", () => {
  it("a fire with ammo spawns a pooled ball at the muzzle and it flies", async () => {
    const sim = await Sim.create();
    sim.mode = SwingMode.Cart;
    expect(sim.cart.ammo).toBeGreaterThan(0);

    const ammoBefore = sim.cart.ammo;
    sim.step({ ...IDLE_INTENT, fire: true });
    sim.step({ ...IDLE_INTENT, fire: false });

    expect(sim.cart.ammo).toBe(ammoBefore - 1);
    expect(sim.lastShotWasStrike).toBe(true);
  });

  it("firing at 0 ammo produces a recoil-only blank: no strike, ammo stays at 0", async () => {
    const sim = await Sim.create();
    sim.mode = SwingMode.Cart;
    sim.cart.ammo = 0;
    const recoilBefore = { x: sim.cart.recoil.x, z: sim.cart.recoil.z };

    sim.step({ ...IDLE_INTENT, fire: true });
    sim.step({ ...IDLE_INTENT, fire: false });

    expect(sim.cart.ammo).toBe(0);
    expect(sim.lastShotWasStrike).toBe(false);
    expect(sim.cart.recoil.x).not.toBeCloseTo(recoilBefore.x, 9);
  });

  it("does not touch stationary mode's stroke count or ball state", async () => {
    const sim = await Sim.create();
    sim.mode = SwingMode.Stationary;
    const strokesBefore = sim.strokes;

    sim.step({ ...IDLE_INTENT, fire: true });
    sim.step({ ...IDLE_INTENT, fire: false });

    // Stationary mode's own resting/holedOut rules still gate whether this counted as a shot;
    // this test only asserts the cart-mode ammo fork left strokes bookkeeping untouched, i.e.
    // it moved by the same amount cart-mode ammo work would never have caused on its own.
    expect(sim.cart.ammo).toBe(30);
    expect(sim.strokes).toBe(strokesBefore + (sim.lastShotWasStrike ? 1 : 0));
  });
});
```

Check the top of `src/sim/world.cart.test.ts` for its existing imports (`Sim`, `SwingMode`, and
whatever `IDLE_INTENT`-equivalent neutral-intent helper it already uses) and match that pattern
exactly rather than re-importing — this file already has working Sim-integration test
scaffolding from earlier cart-mode work; reuse it instead of inventing a parallel helper.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/sim/world.cart.test.ts`
Expected: FAIL — cart-mode fire currently still uses the `ballLoaded`/single-`Sim.ball` path, so `sim.cart.ammo` never decrements and `sim.lastShotWasStrike` follows the old `ballLoaded` rule instead.

- [ ] **Step 3: Implement the world.ts integration**

Update the import block at the top of `src/sim/world.ts`:

```ts
import RAPIER from "@dimforge/rapier3d-compat";
import { ClubType, computeLaunchVelocity } from "../physics/Ballistics";
import { neutralIntent } from "../input/InputSource";
import type { PlayerIntent } from "../input/InputSource";
import { BUCKET_REFILL_AMMO, CART_COLLIDER, Cart, computeMuzzle } from "./entities/Cart";
import { BallPool } from "./entities/BallPool";
import type { PooledBall } from "./entities/BallPool";
import { createBucket, stepBucket, tryTakeBucket } from "./entities/Pickup";
import type { Bucket } from "./entities/Pickup";
import {
  CUP_POSITION,
  CUP_RADIUS,
  FIELD_SIZE,
  NCOLS,
  NROWS,
  TEE_POSITION,
  buildHeightfield,
  heightAt,
} from "./terrain";
import { SURFACES, SurfaceId, surfaceAt, tuningAt } from "./surfaces";
```

Add fields to the `Sim` class, next to the existing cart-related fields (after `readonly cart = new Cart();`):

```ts
  private ballPool!: BallPool;
  /** One hardcoded bucket for now -- course-scale placement is explicitly out of scope, see
   * docs/superpowers/specs/2026-09-02-cart-ammo-design.md §7. */
  private readonly buckets: Bucket[] = [createBucket(TEE_POSITION.x + 10, TEE_POSITION.z)];
  /** Seconds of sim time elapsed, used only for BallPool's landed-ball despawn timer. */
  private simTime = 0;
```

In `static async create()`, after the existing ball/cart/collider/controller setup and before
`sim.syncCurrent();`, add:

```ts
    sim.ballPool = new BallPool(sim.world);
```

Replace `resolveShot()` with the forked version:

```ts
  /**
   * Cart mode and stationary mode resolve a shot through entirely separate paths now: cart
   * mode spawns from the ammo-gated BallPool, stationary mode plays the single Sim.ball where
   * it lies. See docs/superpowers/specs/2026-09-02-cart-ammo-design.md §1 for why they aren't
   * unified.
   */
  private resolveShot(): void {
    if (this.mode === SwingMode.Cart) {
      this.lastShotWasStrike = this.cart.shot.hasBall;
      if (!this.cart.shot.hasBall) return;

      const pooled = this.ballPool.acquire();
      if (!pooled) {
        // All POOL_SIZE bodies are in flight simultaneously -- an extreme, likely
        // untestable-in-practice case (spec §6). Cart.fire() already decremented ammo on the
        // assumption a ball would spawn; refund it so this degrades to a true no-op rather
        // than costing ammo for nothing.
        this.cart.addAmmo(1);
        return;
      }

      computeMuzzle(this.cart, this.muzzleScratch);
      pooled.body.setTranslation(this.muzzleScratch, true);
      pooled.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      pooled.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      pooled.body.setLinvel(
        computeLaunchVelocity(this.cart.shot.club, this.cart.shot.charge01, this.cart.shot.yaw),
        true,
      );
      return;
    }

    const playable = this.isResting() && !this.holedOut;
    this.lastShotWasStrike = playable;
    if (!playable) return;

    this.launch(this.cart.shot.yaw, this.cart.shot.charge01, this.cart.shot.club);
  }
```

Update `stepCart()` to tick the pool and buckets and apply pickups, right after the existing
`ballInReach`/`ballLoaded` computation and before the `if (this.cart.shot.fired)` block:

```ts
  private stepCart(intent: PlayerIntent): void {
    if (intent.toggleMode) {
      this.mode = this.mode === SwingMode.Cart ? SwingMode.Stationary : SwingMode.Cart;
    }
    if (intent.selectClub !== null) this.cart.selectClub(intent.selectClub);

    const driving = this.mode === SwingMode.Cart;
    const c = this.cart.position;
    this.cart.step(driving ? intent : this.parkedIntent(intent), FIXED_DT, tuningAt(c.x, c.z));

    if (driving) this.moveCartBody();

    const b = this.current.position;
    this.ballInReach = Math.hypot(b.x - c.x, b.z - c.z) <= PICKUP_RANGE;
    this.ballLoaded = driving && this.ballInReach && this.isResting() && !this.holedOut;

    this.simTime += FIXED_DT;
    this.ballPool.step(FIXED_DT, this.simTime);

    for (const bucket of this.buckets) {
      stepBucket(bucket, FIXED_DT);
      if (tryTakeBucket(bucket, c.x, c.z, PICKUP_RANGE)) this.cart.addAmmo(BUCKET_REFILL_AMMO);
    }
    for (const landed of this.ballPool.ballsNear(c.x, c.z, PICKUP_RANGE)) {
      this.cart.addAmmo(1);
      this.ballPool.release(landed);
    }

    if (this.cart.shot.fired) {
      this.cart.shot.fired = false;
      this.resolveShot();
    }
  }
```

`ballInReach`/`ballLoaded` are left computed exactly as before even though cart mode's shot
resolution no longer reads `ballLoaded`. This is not harmless vestigial state, though: a final
whole-branch review found that `src/render/scene.ts` and `src/main.ts` *do* currently read
`sim.ballLoaded`/`view.ballLoaded` in cart mode — for ball visibility, the turret-riding render,
and HUD strings like "fire to play it". Since this branch's fork replaced cart mode's "drive over
the ball to load it" mechanic with the ammo/pool system, those reads are now stale/incorrect for
cart mode specifically: the ball no longer "loads" onto the turret the way `ballLoaded` describes,
so the render/HUD code driven by it is describing a mechanic that no longer exists in cart mode.
This plan makes no render-layer changes, so fixing those reads is out of scope here, but it is a
real bug for the next render-facing session to fix, not a piece of dead state it can ignore.

`Sim.reset()` is intentionally left untouched: the spec does not define hole-transition
behavior for ammo/pool/bucket state (whether a new hole should refill ammo to `STARTING_AMMO`,
for instance), so this plan leaves that state persisting across `reset()` rather than inventing
an unspecified rule. Flag this as an open question for whoever scopes STROKE-mode hole
transitions alongside combat mode.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/sim/world.cart.test.ts src/sim/entities/Cart.test.ts src/sim/entities/BallPool.test.ts src/sim/entities/Pickup.test.ts`
Expected: PASS, all four files.

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — in particular, all existing stationary-mode tests in `src/sim/world.*.test.ts` unaffected (regression check that the fork didn't leak state across modes).

- [ ] **Step 6: Commit**

```bash
git add src/sim/world.ts src/sim/world.cart.test.ts
git commit -m "feat(sim): wire ammo-gated BallPool and bucket pickups into cart-mode shots"
```

---

## Task 5: Cross-reference the spec from the roadmap/backlog docs

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `docs/BACKLOG.md`

This is the outstanding doc-update item flagged in the prior session's handoff: the
Phase-1.75-deprioritization / combat-pulled-forward decision, and this spec's existence, are
currently only recorded in conversation history and the spec file itself. This task makes them
discoverable from the docs a fresh reader would open first. No tests — doc-only.

- [ ] **Step 1: Update docs/ROADMAP.md**

Find Phase 1.75's heading (app shell, screens, par-per-hole scorecard) and add a one-line note
directly under it:

```markdown
> **Status note (2026-09-02):** Deprioritized, not dropped — combat gameplay (cart-vs-cart
> shooting) is the current priority; see the ammo/pooled-ball spec below. STROKE mode stays a
> real future destination once combat has an audience.
```

Find Phase 3's "Ammo as a real resource" checklist item (~line 309) and mark it in progress with
a pointer to the spec:

```markdown
- [ ] Ammo as a real resource — **in progress**, see
  `docs/superpowers/specs/2026-09-02-cart-ammo-design.md` and
  `docs/superpowers/plans/2026-09-02-cart-ammo-implementation.md`.
```

- [ ] **Step 2: Update docs/BACKLOG.md**

Find item `#16a` (Ammo per club) and item `#24` (Food & drink cart pickups) and add a pointer to
each, noting the scope each one now maps to:

```markdown
#16a. Ammo per club — **superseded in scope**: implemented as one shared pool per cart, not
per-club, per explicit user simplification. See
`docs/superpowers/specs/2026-09-02-cart-ammo-design.md` §1.
```

```markdown
#24. Food & drink cart pickups — the ammo bucket half is **in progress**, see
`docs/superpowers/specs/2026-09-02-cart-ammo-design.md`. Drink/hotdog pickups remain unbuilt and
out of this spec's scope.
```

Add a new backlog row for the course-scale bucket placement follow-up flagged in the spec's §7
forward note, so it isn't lost once this plan's Task 4 ships one hardcoded bucket:

```markdown
#__ (new). Bucket placement validity checks for the full course map — analogous to
`course.ts`'s `validateHole` playability checks. Blocked on the multi-hole map
(`docs/RESEARCH-TERRAIN.md` / the procedural course generator). See
`docs/superpowers/specs/2026-09-02-cart-ammo-design.md` §7.
```

Use the backlog file's existing numbering convention for the new row (read the file to find the
next free number — do not guess one).

- [ ] **Step 3: Commit**

```bash
git add docs/ROADMAP.md docs/BACKLOG.md
git commit -m "docs: cross-reference cart-ammo spec from roadmap and backlog"
```

---

## Self-Review Notes

- **Spec coverage:** §3 data model → Task 1 (Cart) + Task 2 (BallPool) + Task 3 (Pickup). §4
  integration point → Task 4. §5 data flow → exercised end-to-end by Task 4's integration tests.
  §6 edge cases → pool exhaustion (Task 2's null-acquire test + Task 4's refund path), ammo
  can't go negative (Task 1), bucket-at-cap-still-consumes (Task 3's docstring/caller split),
  cross-cart pickup (no cart-identity check anywhere in `ballsNear`/`tryTakeBucket` — allowed by
  omission, matching spec intent), same-tick-convergence (iteration order in `stepCart`'s loops,
  matching existing `ballInReach` resolution). §7 bucket placement → Task 4 (hardcoded position)
  + Task 5 (backlog row for the deferred work). §8 testing → each named test file exists with
  the named assertions across Tasks 1-4.
- **Placeholder scan:** no TBD/TODO/"add error handling" left in any task; both departures from
  the spec's illustrative sketches are justified inline, not hand-waved.
- **Type consistency:** `PooledBall`, `Bucket`, `CartShot.hasBall`, `Cart.ammo`/`addAmmo` are
  used with the same shapes everywhere they appear across Tasks 1-4.

---

**Plan complete and saved to `docs/superpowers/plans/2026-09-02-cart-ammo-implementation.md`.** Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
