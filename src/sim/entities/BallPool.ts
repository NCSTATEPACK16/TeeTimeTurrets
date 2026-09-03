import RAPIER from "@dimforge/rapier3d-compat";
import { BALL_RADIUS as POOLED_BALL_RADIUS } from "./ballShape";

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
  private readonly heightAt: (x: number, z: number) => number;

  constructor(
    world: RAPIER.World,
    heightAt: (x: number, z: number) => number,
    poolSize: number = POOL_SIZE,
  ) {
    this.heightAt = heightAt;
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
        // Combat balls are the ones that hit things, so they carry the collision events
        // sim/combat.ts dispatches on.
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
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

  /** flying -> landed on sustained rest (mirrors world.ts's isGrounded/restTicks pattern);
   * landed -> idle after LANDED_BALL_DESPAWN_S with no pickup. */
  step(_dt: number, simTime: number): void {
    for (const ball of this.balls) {
      if (ball.state === "flying") {
        const t = ball.body.translation();
        const v = ball.body.linvel();
        const grounded = t.y - this.heightAt(t.x, t.z) < POOLED_BALL_RADIUS * 2;
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
