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
  /**
   * True once this flight has come down onto the ground. A ball that has touched down is rolling,
   * not flying at anyone, so `acquire` may recycle it before it has come fully to rest.
   */
  touchedDown: boolean;
  /** Consecutive ticks spent grounded and slow, toward `REST_HOLD_TICKS`. */
  restTicks: number;
  /**
   * Where the body was, and how fast it was going, after the last world step: read once per tick by
   * `BallPool.sync` and used by everything else that asks. Rapier's `translation()` and `linvel()`
   * each return a fresh object, so asking three times a tick was three allocations, and nothing
   * moves a body between the step and the next one except a teleport, which also changes `state`.
   */
  readonly position: Float64Array;
  readonly velocity: Float64Array;
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
/** Handed to Rapier as a velocity; read, never kept, so one frozen object serves every call. */
const ZERO = Object.freeze({ x: 0, y: 0, z: 0 });

export class BallPool {
  private readonly balls: PooledBall[];
  /** Reused per `setLinvel` in the fixed tick. */
  private readonly velocityScratch = { x: 0, y: 0, z: 0 };
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

      this.balls.push({
        body,
        state: "idle",
        landedAt: 0,
        firedBy: NO_KILLER,
        firedAt: 0,
        spent: false,
        damage: 1,
        touchedDown: false,
        restTicks: 0,
        position: new Float64Array([PARKED_POSITION.x, PARKED_POSITION.y, PARKED_POSITION.z]),
        velocity: new Float64Array(3),
      });
    }
  }

  /**
   * idle -> flying, taking the first body free in this order:
   * 1. an `idle` one;
   * 2. the oldest `landed` one;
   * 3. the oldest `flying` one that has touched down or already hit something, so it is only
   *    rolling and no longer a shot at anyone;
   * 4. only when `takeOthersInFlight` is set, the oldest ball still in the air that someone
   *    **else** fired.
   *
   * Step 4 is for the player alone (docs/DECISIONS.md, 2026-09-27). In a 4v4 the bots keep every
   * body in the air most of the time, and a refused shot is a trigger pull that silently does
   * nothing. The player's shot therefore takes a bot's ball out of the air rather than fail. A bot
   * is still refused, and holds fire.
   *
   * Returns null when none of those is available; the caller degrades to a blank shot.
   *
   * `firedBy` has **no default**, on purpose. Every call site has to answer "whose shot is this"
   * rather than inherit an answer, because the wrong answer here is a kill credited to the wrong
   * cart and nothing about it would look wrong at the call site.
   */
  acquire(firedBy: number, takeOthersInFlight = false): PooledBall | null {
    let landed: PooledBall | null = null;
    let rolling: PooledBall | null = null;
    let airborne: PooledBall | null = null;
    for (const b of this.balls) {
      if (b.state === "idle") return this.beginFlight(b, firedBy);
      if (b.state === "landed") {
        if (!landed || b.landedAt < landed.landedAt) landed = b;
      } else if (b.touchedDown || b.spent) {
        if (!rolling || b.firedAt < rolling.firedAt) rolling = b;
      } else if (b.firedBy !== firedBy) {
        if (!airborne || b.firedAt < airborne.firedAt) airborne = b;
      }
    }
    const taken = landed ?? rolling ?? (takeOthersInFlight ? airborne : null);
    return taken ? this.beginFlight(taken, firedBy) : null;
  }

  private beginFlight(ball: PooledBall, firedBy: number): PooledBall {
    ball.state = "flying";
    ball.firedBy = firedBy;
    ball.firedAt = this.now;
    ball.spent = false;
    ball.touchedDown = false;
    ball.body.setEnabled(true);
    ball.body.collider(0).setEnabled(true);
    ball.restTicks = 0;
    return ball;
  }

  /** -> idle, teleported off-world with its collider disabled and the body itself disabled so it
   * stops integrating under gravity while parked (a dynamic body never sleeps under constant
   * gravity, so leaving it enabled would have it fall forever). */
  release(ball: PooledBall): void {
    ball.state = "idle";
    ball.firedBy = NO_KILLER;
    ball.body.setTranslation(PARKED_POSITION, true);
    ball.body.setLinvel(ZERO, true);
    ball.body.setAngvel(ZERO, true);
    ball.body.collider(0).setEnabled(false);
    ball.body.setEnabled(false);
    ball.restTicks = 0;
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
    for (let i = 0; i < this.balls.length; i++) {
      const ball = this.balls[i]!;
      if (ball.state === "flying") {
        if (simTime - ball.firedAt >= MAX_FLIGHT_S) {
          this.release(ball);
          continue;
        }
        const p = ball.position;
        const grounded = p[1]! - this.ground.heightAt(p[0]!, p[2]!) < POOLED_BALL_RADIUS * 2;
        if (grounded) {
          ball.touchedDown = true;
          this.applyRollingResistance(ball, dt);
        }
        const v = ball.velocity;
        const slow = Math.hypot(v[0]!, v[1]!, v[2]!) < REST_SPEED_THRESHOLD;
        const ticks = grounded && slow ? ball.restTicks + 1 : 0;
        ball.restTicks = ticks;
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
  private applyRollingResistance(ball: PooledBall, dt: number): void {
    if (!this.ground.tuningAt) return;
    const tuning = this.tuningScratch;
    const p = ball.position;
    this.ground.tuningAt(p[0]!, p[2]!, tuning);
    const v = ball.velocity;
    const horizontalSpeed = Math.hypot(v[0]!, v[2]!);
    const speedDrop = tuning.rolling * GRAVITY * dt;
    const scale = horizontalSpeed < 1e-4 ? 1 : Math.max(0, 1 - speedDrop / horizontalSpeed);
    const bounceY = v[1]! > 0 ? v[1]! * tuning.bounceScale : v[1]!;
    const next = this.velocityScratch;
    next.x = v[0]! * scale;
    next.y = bounceY;
    next.z = v[2]! * scale;
    ball.body.setLinvel(next, true);
    // Rapier keeps velocity in single precision, so the cache holds what `linvel()` would now return.
    v[0] = Math.fround(next.x);
    v[1] = Math.fround(next.y);
    v[2] = Math.fround(next.z);
  }

  /**
   * Reads every live body's position and velocity once, after the world step, into the balls'
   * caches. Idle bodies are parked and never read. The one place the pool asks Rapier where a ball
   * is, per tick.
   */
  sync(): void {
    for (let i = 0; i < this.balls.length; i++) {
      const ball = this.balls[i]!;
      if (ball.state === "idle") continue;
      const t = ball.body.translation();
      ball.position[0] = t.x;
      ball.position[1] = t.y;
      ball.position[2] = t.z;
      const v = ball.body.linvel();
      ball.velocity[0] = v.x;
      ball.velocity[1] = v.y;
      ball.velocity[2] = v.z;
    }
  }

  /** Every pooled body, whatever its state -- for one-time setup like registering colliders for
   * collision events. Not for per-tick use; `ballsNear` is the query path. */
  get all(): readonly PooledBall[] {
    return this.balls;
  }

  /**
   * "landed" balls within `radius`, for pickup checks, written into `out` from index 0; returns
   * how many. `out` is the caller's and is grown only the first time it is too short.
   */
  ballsNear(x: number, z: number, radius: number, out: PooledBall[]): number {
    let n = 0;
    for (let i = 0; i < this.balls.length; i++) {
      const b = this.balls[i]!;
      if (b.state !== "landed") continue;
      if (Math.hypot(b.position[0]! - x, b.position[2]! - z) > radius) continue;
      out[n++] = b;
    }
    return n;
  }
}
