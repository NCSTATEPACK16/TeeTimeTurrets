import RAPIER from "@dimforge/rapier3d-compat";
import { NO_KILLER } from "../matchConfig";
import { createSurfaceTuning } from "../surfaces";
import type { MutableSurfaceTuning } from "../surfaces";
import { BALL_RADIUS as POOLED_BALL_RADIUS } from "./ballShape";
import { BALL_GROUPS } from "../collisionGroups";

/** Sim-only pooled combat balls for cart mode. No render/HUD concerns here — see the spec's
 * explicit out-of-scope list (docs/superpowers/specs/2026-09-02-cart-ammo-design.md §1). */

export type BallState = "idle" | "flying" | "landed";

export interface PooledBall {
  body: RAPIER.RigidBody;
  state: BallState;
  landedAt: number;
  /**
   * Which rig fired this ball, or `NO_KILLER` while it belongs to nobody.
   *
   * Arena scores a kill against whoever fired the ball, so this is the fact the whole scoring
   * system rests on -- and until Stage C it did not exist anywhere in the sim.
   * `docs/TEST-AND-SPEC-PITFALLS.md` §4 records the consequence: `combat.ts` credited every
   * ball's hit to the player, latent only because `accuracy()` had no non-test caller.
   *
   * Cleared on release, because a pool of 32 bodies recycles and a stale owner on an idle body
   * is a kill waiting to be credited to the wrong cart.
   */
  firedBy: number;
  /** Sim time the ball left the muzzle, for `MAX_FLIGHT_S`. */
  firedAt: number;
  /**
   * True once this flight has done its damage. A cart has two colliders (capsule and hull), and a
   * ball can graze both or bounce back into one; a shot is one hit however many contacts it makes.
   */
  spent: boolean;
  /** Health points this ball takes off a cart: its club's `damage`, stamped when it is fired. */
  damage: number;
}

export const POOL_SIZE = 32;
export const LANDED_BALL_DESPAWN_S = 15;
/**
 * A ball still flying after this long is given back to the pool. Rolling resistance brings a ball on
 * any real slope to rest well inside it; this is the backstop for one that never settles (caught on a
 * seam, jittering in a hollow) so it cannot hold a pool slot for the rest of the match.
 */
export const MAX_FLIGHT_S = 20;

/**
 * The ground a pooled ball rolls on: its height, for "has it come down", and its material, for how
 * hard the turf drags at it. `tuningAt` is optional so a test can hand the pool bare flat ground.
 */
export interface PoolGround {
  heightAt(x: number, z: number): number;
  tuningAt?(x: number, z: number, out: MutableSurfaceTuning): void;
}

/** Matches world.ts's GRAVITY; a leaf module cannot import it from there without a cycle. */
const GRAVITY = 9.81;

// POOLED_BALL_RADIUS comes from ballShape.ts, the shared leaf module -- see its docstring. The
// rest still mirrors world.ts's BALL_DENSITY/etc: those aren't shared because nothing outside
// world.ts needs them to agree, unlike the radius (which render also has to match). Keep these
// in sync if the stationary ball's tuning changes.
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
  private readonly ground: PoolGround;
  private readonly tuningScratch = createSurfaceTuning();
  /** Sim time as of the last `step`, so `acquire` can stamp `firedAt` without being passed it. */
  private now = 0;

  constructor(world: RAPIER.World, ground: PoolGround, poolSize: number = POOL_SIZE) {
    this.ground = ground;
    this.balls = [];
    for (let i = 0; i < poolSize; i++) {
      const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(PARKED_POSITION.x, PARKED_POSITION.y, PARKED_POSITION.z)
        .setCcdEnabled(true)
        .setLinearDamping(POOLED_BALL_LINEAR_DAMPING)
        .setAngularDamping(POOLED_BALL_ANGULAR_DAMPING);
      const body = world.createRigidBody(bodyDesc);
      body.setEnabled(false);

      const colliderDesc = RAPIER.ColliderDesc.ball(POOLED_BALL_RADIUS)
        .setDensity(POOLED_BALL_DENSITY)
        .setFriction(POOLED_BALL_FRICTION)
        .setRestitution(POOLED_BALL_RESTITUTION)
        .setCollisionGroups(BALL_GROUPS)
        // Combat balls are the ones that hit things, so they carry the collision events
        // sim/combat.ts dispatches on.
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
        .setEnabled(false);
      world.createCollider(colliderDesc, body);

      this.balls.push({ body, state: "idle", landedAt: 0, firedBy: NO_KILLER, firedAt: 0, spent: false, damage: 1 });
      this.restTicks.set(body, 0);
    }
  }

  /**
   * idle -> flying. Force-recycles the oldest `landed` ball if no `idle` body remains (never a
   * `flying` one -- an in-flight shot must never vanish mid-arc). Returns null only when every
   * pooled body is simultaneously `flying`; the caller must degrade to a blank shot in that case.
   *
   * `firedBy` has **no default**, on purpose. Every call site has to answer "whose shot is this"
   * rather than inherit an answer, because the wrong answer here is a kill credited to the wrong
   * cart and nothing about it would look wrong at the call site.
   */
  acquire(firedBy: number): PooledBall | null {
    const idle = this.balls.find((b) => b.state === "idle");
    if (idle) return this.beginFlight(idle, firedBy);

    const landed = this.balls.filter((b) => b.state === "landed");
    if (landed.length === 0) return null;
    let oldest = landed[0];
    for (const b of landed) if (b.landedAt < oldest.landedAt) oldest = b;
    return this.beginFlight(oldest, firedBy);
  }

  private beginFlight(ball: PooledBall, firedBy: number): PooledBall {
    ball.state = "flying";
    ball.firedBy = firedBy;
    ball.firedAt = this.now;
    ball.spent = false;
    ball.body.setEnabled(true);
    ball.body.collider(0).setEnabled(true);
    this.restTicks.set(ball.body, 0);
    return ball;
  }

  /** -> idle, teleported off-world with its collider disabled and the body itself disabled so it
   * stops integrating under gravity while parked (a dynamic body never sleeps under constant
   * gravity, so leaving it enabled would have it fall forever). */
  release(ball: PooledBall): void {
    ball.state = "idle";
    ball.firedBy = NO_KILLER;
    ball.body.setTranslation(PARKED_POSITION, true);
    ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    ball.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    ball.body.collider(0).setEnabled(false);
    ball.body.setEnabled(false);
    this.restTicks.set(ball.body, 0);
  }

  /** Releases every ball not already idle. Used when swapping holes so stale in-flight/landed
   * balls from the previous hole don't survive into the new one. */
  releaseAll(): void {
    for (const ball of this.balls) {
      if (ball.state !== "idle") this.release(ball);
    }
  }

  /**
   * flying -> landed on sustained rest (mirrors world.ts's isGrounded/restTicks pattern);
   * landed -> idle after LANDED_BALL_DESPAWN_S with no pickup; flying -> idle after MAX_FLIGHT_S.
   *
   * A grounded flying ball is also dragged by the turf it is rolling on. Rapier's damping alone
   * decays toward a terminal creep on any slope rather than to a stop (docs/DECISIONS.md "Rolling
   * resistance"), and a ball that never stops never lands -- so it could never be picked up as
   * ammo, never despawn, and would hold its pool slot until every shot came out a blank.
   */
  step(dt: number, simTime: number): void {
    this.now = simTime;
    for (const ball of this.balls) {
      if (ball.state === "flying") {
        if (simTime - ball.firedAt >= MAX_FLIGHT_S) {
          this.release(ball);
          continue;
        }
        const t = ball.body.translation();
        const grounded = t.y - this.ground.heightAt(t.x, t.z) < POOLED_BALL_RADIUS * 2;
        if (grounded) this.applyRollingResistance(ball.body, t.x, t.z, dt);
        const v = ball.body.linvel();
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

  /**
   * Constant deceleration against horizontal motion plus a per-surface bounce cut, clamped so it
   * stops the ball rather than reversing it. Direct velocity changes rather than impulses, so the
   * result is mass-independent and exactly reproducible on an authoritative server.
   */
  private applyRollingResistance(body: RAPIER.RigidBody, x: number, z: number, dt: number): void {
    if (!this.ground.tuningAt) return;
    const tuning = this.tuningScratch;
    this.ground.tuningAt(x, z, tuning);
    const v = body.linvel();
    const horizontalSpeed = Math.hypot(v.x, v.z);
    const speedDrop = tuning.rolling * GRAVITY * dt;
    const scale = horizontalSpeed < 1e-4 ? 1 : Math.max(0, 1 - speedDrop / horizontalSpeed);
    const bounceY = v.y > 0 ? v.y * tuning.bounceScale : v.y;
    body.setLinvel({ x: v.x * scale, y: bounceY, z: v.z * scale }, true);
  }

  /** Every pooled body, whatever its state -- for one-time setup like registering colliders for
   * collision events. Not for per-tick use; `ballsNear` is the query path. */
  get all(): readonly PooledBall[] {
    return this.balls;
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
