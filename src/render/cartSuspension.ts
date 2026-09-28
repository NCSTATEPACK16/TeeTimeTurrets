/**
 * The cart's body riding the ground: pitch and roll fitted from the ground under its four wheels,
 * and a heave that dips on landing, each on a critically damped spring.
 *
 * Render-only. The sim's cart is a capsule that never tilts, and nothing here reaches it, so the
 * golden fingerprint cannot move for it; the springs only decide how the model sits on the
 * position the sim gave it. Allocation-free per frame.
 */

/** Half the wheelbase and half the track, metres: where the four wheels touch. */
const HALF_BASE_M = 1.1;
const HALF_TRACK_M = 0.6;
/** Spring rate: 2 Hz. */
const OMEGA = 2 * Math.PI * 2;
/** Share of the fall speed the landing turns into heave speed. */
const LANDING_SHARE = 0.3;
/** Fall speed, m/s, below which a stop counts as a landing rather than the cart settling. */
const LANDING_MIN_FALL = 3;
/** The deepest the body may dip, metres. */
const MAX_DIP_M = 0.3;

export interface GroundFit {
  /** Nose-up, radians. */
  pitch: number;
  /** Positive lifts the cart's left side (its local +X), radians. */
  roll: number;
  /** Mean wheel height above the ground at the cart's centre, metres. */
  height: number;
}

/** Fits the ground plane under the four wheels of a cart at (x, z) facing `heading`. */
export function fitCartGround(
  heightAt: (x: number, z: number) => number,
  x: number,
  z: number,
  heading: number,
  out: GroundFit,
): void {
  const fx = Math.cos(heading);
  const fz = Math.sin(heading);
  // The model's local +X, in the world: see `placeCart`'s yaw.
  const lx = fz;
  const lz = -fx;
  const front = HALF_BASE_M;
  const side = HALF_TRACK_M;
  const fl = heightAt(x + fx * front + lx * side, z + fz * front + lz * side);
  const fr = heightAt(x + fx * front - lx * side, z + fz * front - lz * side);
  const rl = heightAt(x - fx * front + lx * side, z - fz * front + lz * side);
  const rr = heightAt(x - fx * front - lx * side, z - fz * front - lz * side);
  out.pitch = Math.atan((fl + fr - rl - rr) / (4 * HALF_BASE_M));
  out.roll = Math.atan((fl + rl - fr - rr) / (4 * HALF_TRACK_M));
  out.height = (fl + fr + rl + rr) / 4 - heightAt(x, z);
}

export class CartSuspension {
  pitch = 0;
  roll = 0;
  heave = 0;
  private pitchV = 0;
  private rollV = 0;
  private heaveV = 0;
  private lastY = Number.NaN;
  private lastVy = 0;
  private readonly fit: GroundFit = { pitch: 0, roll: 0, height: 0 };
  private readonly step: SpringState = { value: 0, velocity: 0 };

  /** `y` is the height the sim puts the cart's base at this frame. */
  update(
    dt: number,
    x: number,
    y: number,
    z: number,
    heading: number,
    heightAt: (x: number, z: number) => number,
  ): void {
    if (!(dt > 0)) return;
    fitCartGround(heightAt, x, z, heading, this.fit);

    const vy = Number.isNaN(this.lastY) ? 0 : (y - this.lastY) / dt;
    // A fall that stops is a landing: the body carries on down a little and springs back.
    if (this.lastVy < -LANDING_MIN_FALL && vy > this.lastVy + LANDING_MIN_FALL * 0.5) {
      this.heaveV += this.lastVy * LANDING_SHARE;
    }
    this.lastY = y;
    this.lastVy = vy;

    spring(this.pitch, this.pitchV, this.fit.pitch, dt, this.step);
    this.pitch = this.step.value;
    this.pitchV = this.step.velocity;
    spring(this.roll, this.rollV, this.fit.roll, dt, this.step);
    this.roll = this.step.value;
    this.rollV = this.step.velocity;
    spring(this.heave, this.heaveV, this.fit.height, dt, this.step);
    this.heave = this.step.value;
    this.heaveV = this.step.velocity;
    if (this.heave < -MAX_DIP_M) {
      this.heave = -MAX_DIP_M;
      this.heaveV = Math.max(0, this.heaveV);
    }
  }
}

/**
 * One step of a critically damped spring toward `target`, solved exactly rather than integrated,
 * so a long frame lands closer rather than overshooting.
 */
function spring(value: number, velocity: number, target: number, dt: number, out: SpringState): void {
  const d = value - target;
  const e = Math.exp(-OMEGA * dt);
  const k = velocity + OMEGA * d;
  out.value = target + (d + k * dt) * e;
  out.velocity = (velocity - OMEGA * k * dt) * e;
}

interface SpringState {
  value: number;
  velocity: number;
}
