import RAPIER from "@dimforge/rapier3d-compat";
import { ClubType, computeLaunchVelocity } from "../physics/Ballistics";
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

/** DOM-free physics module. No rendering, no input handling, no globals — just state in, state out. */
export const FIXED_DT = 1 / 60;

const BALL_RADIUS = 0.15;

/**
 * Rapier's linear damping is the ball's *air* drag only (F = -k*v, applied in flight and on
 * the ground alike). Ground roll-out is governed by ANGULAR_DAMPING instead -- see below.
 * The old 0.15 was doing both jobs and doing neither well: it cost a driver ~44% of its
 * speed over a 3.8 s flight while still leaving a 6 m/s roll ~31 s of exponential creep
 * before it crossed the rest threshold (measured 11.3 s for a 7 m putt, tools/feelProbe.ts).
 */
const LINEAR_DAMPING = 0.05;

/**
 * Turf drag, applied via spin: for a rolling sphere (I = 2/5 m r^2, v = w*r) an angular
 * damping torque decelerates translation at (2/7)*k_angular, so this contributes a
 * velocity-proportional rate of ~0.17/s on top of LINEAR_DAMPING. Launch zeroes angular
 * velocity, so it costs nothing in flight.
 *
 * Kept deliberately low. It was 3.8 while it was the *only* thing ending a roll; once
 * ROLLING_RESISTANCE existed that job moved, and the leftover 3.8 was strong enough that a
 * 2 m putt stopped 0.7 m short of the cup (measured). Velocity-proportional damping bites
 * hardest exactly where a putt lives, so it has to stay small now that it is not load-bearing.
 */
const ANGULAR_DAMPING = 0.6;

/**
 * Rolling resistance is applied as a constant deceleration crr*g against horizontal motion
 * while grounded, which is what real rolling resistance is, with crr looked up per surface
 * from sim/surfaces.ts.
 *
 * This is not a duplicate of the damping above: velocity-proportional damping decays toward
 * zero without reaching it, so on a slope the ball settles at a terminal creep speed where
 * damping balances gravity rather than stopping. At the terrain's 4.3 deg mean grade that
 * creep is ~0.48 m/s -- above any usable rest threshold -- so the ball rolls downhill
 * indefinitely (measured: a 7 m putt took 17 s to register at rest). A constant deceleration
 * has a static threshold: it holds the ball on any grade shallower than atan(crr) and brings
 * it to a full stop in finite time.
 */
const GRAVITY = 9.81;

/** Ball must be this slow and inside the cup radius to count as holed rather than lipping out. */
const HOLE_OUT_SPEED = 2.5;

/**
 * Restitution combines by averaging with the ground's 0.15, so the ball's 0.35 gives an
 * effective 0.25. Lower than the previous 0.30 mostly to cut chatter off the heightfield's
 * triangle seams, which a rolling ball hits as a normal discontinuity every ~1 m.
 */
const BALL_RESTITUTION = 0.35;

/**
 * kg/m^3. The previous 1.2 gave a 17 g ball at this radius -- roughly air. Phase 0
 * trajectories are provably unchanged by this: against a fixed collider, gravity, damping,
 * and restitution/friction impulse resolution are all mass-independent.
 *
 * 1130 is real golf-ball density (~46 g at this radius), and THIS VALUE IS EXPECTED TO RISE
 * IN PHASE 3 -- realism is the thing that breaks the ragdoll, not the thing that saves it.
 * A 46 g ball against a multi-kg torso capsule is a ~1:100 mass ratio struck at driver
 * velocity: the worst case for any impulse-based solver, and unfixable by joint tuning.
 * Phase 3 raises this until the ratio against the heaviest limb is <= 1:20.
 *
 * The mass-independence above is what makes that nearly free -- ball flight does not change,
 * only the ball's authority in a collision with another dynamic body. Re-run `npm run probe`
 * after changing it to confirm rather than assume.
 *
 * See docs/DECISIONS.md "Ball mass". The CTF flag-ball is on the other side of this problem
 * (deliberately heavy, must be struck rather than carried) and wants its own density.
 */
const BALL_DENSITY = 1130;

/**
 * Rest detection. The threshold is deliberately well above zero because exponential decay
 * never actually reaches zero, and it is held for REST_HOLD_TICKS *with ground contact*
 * because at the apex of a bounce vertical velocity passes through zero -- speed alone
 * reads "at rest" in mid-air and would let the player swing at a ball still in flight.
 */
const REST_SPEED_THRESHOLD = 0.25;
const REST_HOLD_TICKS = 12;

/** Past this the ball has left the heightfield and is in free fall over nothing. */
const OUT_OF_BOUNDS_Y = -20;

/** Phase 0 has one club equipped permanently; club selection lands in Phase 2 (see docs/ROADMAP.md). */
const DEFAULT_CLUB = ClubType.Driver;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface BallTransform {
  position: Vec3;
  rotation: Quat;
}

export class Sim {
  private world!: RAPIER.World;
  private ball!: RAPIER.RigidBody;
  /** State from the previous fixed step, kept for render interpolation. */
  previous: BallTransform;
  /** State from the most recent fixed step. */
  current: BallTransform;
  /** True when the last shot left the field and was returned to the tee. UI can read this. */
  lastShotOutOfBounds = false;
  /** True when the last shot found water and was returned with a penalty. */
  lastShotInWater = false;
  /** Strokes played on this hole, including penalties. */
  strokes = 0;
  /** Set once the ball is in the cup; further launches are ignored until reset. */
  holedOut = false;
  /** Surface under the ball as of the last tick. Drives roll-out, and later the cart and HUD. */
  surfaceUnderBall: SurfaceId = SurfaceId.Fairway;
  /** Where the ball last came to rest on playable ground -- the drop point after a hazard. */
  private lastSafePosition = { ...TEE_POSITION };
  /** Consecutive ticks the ball has been slow and grounded; see REST_HOLD_TICKS. */
  private restTicks = REST_HOLD_TICKS;

  private constructor() {
    this.previous = restTransform();
    this.current = restTransform();
  }

  static async create(): Promise<Sim> {
    await RAPIER.init();
    const sim = new Sim();

    sim.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    sim.world.timestep = FIXED_DT;

    const heights = buildHeightfield();
    const groundDesc = RAPIER.ColliderDesc.heightfield(NROWS, NCOLS, heights, {
      x: FIELD_SIZE,
      y: 1,
      z: FIELD_SIZE,
    })
      .setFriction(0.8)
      .setRestitution(0.15);
    sim.world.createCollider(groundDesc);

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(TEE_POSITION.x, TEE_POSITION.y, TEE_POSITION.z)
      .setCcdEnabled(true)
      .setLinearDamping(LINEAR_DAMPING)
      .setAngularDamping(ANGULAR_DAMPING);
    sim.ball = sim.world.createRigidBody(bodyDesc);

    const ballColliderDesc = RAPIER.ColliderDesc.ball(BALL_RADIUS)
      .setDensity(BALL_DENSITY)
      .setFriction(0.55)
      .setRestitution(BALL_RESTITUTION);
    sim.world.createCollider(ballColliderDesc, sim.ball);

    sim.syncCurrent();
    sim.previous = sim.current;
    return sim;
  }

  /** Advance exactly one fixed tick. Call in a while-loop from an accumulator, never per render frame. */
  step(): void {
    this.previous = this.current;
    this.world.step();
    this.syncCurrent();

    // The heightfield has no walls, so a ball past its edge free-falls forever and never
    // satisfies isResting() -- the player would be locked out of swinging with only a
    // manual reset to recover. Returning to the tee is also the golf rule for out of bounds.
    if (this.isPastFieldEdge()) {
      this.dropAtLastSafePosition();
      this.lastShotOutOfBounds = true;
      return;
    }

    const p = this.current.position;
    this.surfaceUnderBall = surfaceAt(p.x, p.z);

    if (this.isInCup()) {
      this.holedOut = true;
      this.restTicks = REST_HOLD_TICKS;
      return;
    }

    const grounded = this.isGrounded();
    if (grounded) this.applySurfaceResistance();

    // Water is stroke-and-distance: one penalty, then drop where the ball was last safe.
    // Checked only once settled so the ball is allowed to skip across a pond edge first.
    const v = this.ball.linvel();
    const slow = Math.hypot(v.x, v.y, v.z) < REST_SPEED_THRESHOLD;
    if (this.surfaceUnderBall === SurfaceId.Water && grounded && slow) {
      this.strokes += 1;
      this.dropAtLastSafePosition();
      this.lastShotInWater = true;
      return;
    }

    this.restTicks = slow && grounded ? this.restTicks + 1 : 0;
    if (this.restTicks === REST_HOLD_TICKS && !SURFACES[this.surfaceUnderBall].isHazard) {
      this.lastSafePosition = { x: p.x, y: p.y, z: p.z };
    }
  }

  /**
   * Constant deceleration against horizontal motion plus a per-surface bounce cut, clamped so
   * it stops the ball rather than reversing it. Written as direct velocity changes instead of
   * impulses because the result is then mass-independent and exactly predictable per tick --
   * useful for a module that has to stay reproducible on an authoritative server.
   *
   * Per-surface restitution/friction cannot go on the collider: there is one heightfield
   * collider for the whole course, so a material that varies by position has to be applied
   * here. `bounceScale` is what makes a bunker read as sand rather than as slow fairway.
   */
  private applySurfaceResistance(): void {
    const p = this.current.position;
    const tuning = tuningAt(p.x, p.z);
    const v = this.ball.linvel();

    const horizontalSpeed = Math.hypot(v.x, v.z);
    const speedDrop = tuning.rolling * GRAVITY * FIXED_DT;
    const scale = horizontalSpeed < 1e-4 ? 1 : Math.max(0, 1 - speedDrop / horizontalSpeed);
    const bounceY = v.y > 0 ? v.y * tuning.bounceScale : v.y;

    this.ball.setLinvel({ x: v.x * scale, y: bounceY, z: v.z * scale }, true);
  }

  /** Ball is inside the cup mouth and slow enough to drop rather than lip out. */
  private isInCup(): boolean {
    const p = this.current.position;
    if (Math.hypot(p.x - CUP_POSITION.x, p.z - CUP_POSITION.z) > CUP_RADIUS) return false;
    const v = this.ball.linvel();
    return Math.hypot(v.x, v.y, v.z) < HOLE_OUT_SPEED;
  }

  private dropAtLastSafePosition(): void {
    this.ball.setTranslation(this.lastSafePosition, true);
    this.ball.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.syncCurrent();
    this.previous = this.current;
    this.restTicks = REST_HOLD_TICKS;
  }

  /** yawRadians 0 aims down +X. power is a 0..1 charge fraction from hold duration. */
  launch(yawRadians: number, power: number): void {
    if (this.holedOut) return;
    const velocity = computeLaunchVelocity(DEFAULT_CLUB, power, yawRadians);
    this.ball.setLinvel(velocity, true);
    this.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.strokes += 1;
    this.restTicks = 0;
    this.lastShotOutOfBounds = false;
    this.lastShotInWater = false;
  }

  /** Full reset back to the tee: new hole, stroke count included. */
  reset(): void {
    this.lastSafePosition = { ...TEE_POSITION };
    this.dropAtLastSafePosition();
    this.strokes = 0;
    this.holedOut = false;
    this.lastShotOutOfBounds = false;
    this.lastShotInWater = false;
  }

  isResting(): boolean {
    return this.restTicks >= REST_HOLD_TICKS;
  }

  /** Ball is within one radius of the terrain surface, i.e. not mid-bounce. */
  private isGrounded(): boolean {
    const p = this.current.position;
    return p.y - heightAt(p.x, p.z) < BALL_RADIUS * 2;
  }

  private isPastFieldEdge(): boolean {
    const p = this.current.position;
    const half = FIELD_SIZE / 2;
    return Math.abs(p.x) > half || Math.abs(p.z) > half || p.y < OUT_OF_BOUNDS_Y;
  }

  private syncCurrent(): void {
    const t = this.ball.translation();
    const r = this.ball.rotation();
    this.current = {
      position: { x: t.x, y: t.y, z: t.z },
      rotation: { x: r.x, y: r.y, z: r.z, w: r.w },
    };
  }
}

function restTransform(): BallTransform {
  return { position: { ...TEE_POSITION }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
}
