/**
 * Visual suspension (#51): a cart's body pitches and rolls with the ground under its four wheels,
 * and dips on landing, as a critically damped spring. **Render-only.** The sim's transform is a
 * capsule that never tilts; this tilts the *model* drawn at it, so nothing here can move a shot, a
 * hit or the golden fingerprint.
 *
 * Pure numbers and a height function, no three, so it is testable without a renderer. `RenderScene`
 * keeps one per cart, calls `update` each frame with the interpolated transform, and writes `pitch`,
 * `roll` and `heave` onto the model after `placeCart`.
 *
 * Conventions match the model's: it is yawed by `PI / 2 - heading` about +y, so its local +z is the
 * cart's forward and local +x is `(sin heading, -cos heading)` in world XZ. With rotation order `YXZ`,
 * `pitch` is rotation about local x (positive puts the nose down) and `roll` about local z (positive
 * lifts the local +x side).
 */

/** Wheel contacts from `cart.json`: wheels at x = +-0.68, z = +0.78 and -0.76. */
export const WHEEL_HALF_TRACK_M = 0.68;
export const WHEEL_HALF_BASE_M = 0.77;
/** Spring frequency. Critically damped: it settles without overshoot. */
export const SUSPENSION_HZ = 2;
/** Height above the ground under it at which a cart counts as airborne. */
export const AIRBORNE_GAP_M = 0.25;
/** Heave velocity per m/s of landing speed, downward. */
export const LANDING_KICK = 0.6;
/** Landing speed beyond which the bounce stops growing. */
const MAX_LANDING_SPEED = 10;
/** Furthest the body may sit from rest, so a tall drop cannot sink it through the wheels. */
const MAX_HEAVE_M = 0.18;
const MAX_TILT_RAD = 0.5;
/** Longest frame integrated as one step; longer frames are split. */
const MAX_STEP_S = 1 / 120;
/** A jump this far between frames is a respawn or a water reset: snap rather than spring. */
const TELEPORT_M = 4;

const OMEGA = 2 * Math.PI * SUSPENSION_HZ;

export class CartSuspension {
  pitch = 0;
  roll = 0;
  /** Vertical offset of the body from where the sim puts it, metres. */
  heave = 0;
  private pitchVel = 0;
  private rollVel = 0;
  private heaveVel = 0;
  private lastX = 0;
  private lastY = 0;
  private lastZ = 0;
  private lastVy = 0;
  private airborne = false;
  private primed = false;

  /**
   * `groundY` is the ground-level height of the model's origin (the sim position less the capsule's
   * ground offset), so the airborne test compares like with like.
   */
  update(
    x: number,
    groundY: number,
    z: number,
    heading: number,
    heightAt: (x: number, z: number) => number,
    dt: number,
  ): void {
    const fx = Math.cos(heading);
    const fz = Math.sin(heading);
    const lx = Math.sin(heading);
    const lz = -Math.cos(heading);
    const a = WHEEL_HALF_BASE_M;
    const b = WHEEL_HALF_TRACK_M;
    const frontLeft = heightAt(x + fx * a + lx * b, z + fz * a + lz * b);
    const frontRight = heightAt(x + fx * a - lx * b, z + fz * a - lz * b);
    const backLeft = heightAt(x - fx * a + lx * b, z - fz * a + lz * b);
    const backRight = heightAt(x - fx * a - lx * b, z - fz * a - lz * b);
    const centre = heightAt(x, z);

    // A plane through the four contacts, by least squares on a rectangle: the mean slope each way.
    const front = (frontLeft + frontRight) / 2;
    const back = (backLeft + backRight) / 2;
    const left = (frontLeft + backLeft) / 2;
    const right = (frontRight + backRight) / 2;
    const targetPitch = clamp(Math.atan((back - front) / (2 * a)), MAX_TILT_RAD);
    const targetRoll = clamp(Math.atan((left - right) / (2 * b)), MAX_TILT_RAD);
    // Over a crest the wheels sit below the centre and the body with them; in a dip, above.
    const targetHeave = clamp((frontLeft + frontRight + backLeft + backRight) / 4 - centre, MAX_HEAVE_M);

    const jumped = Math.hypot(x - this.lastX, groundY - this.lastY, z - this.lastZ) > TELEPORT_M;
    const airborne = groundY - centre > AIRBORNE_GAP_M;
    if (!this.primed || jumped) {
      this.pitch = targetPitch;
      this.roll = targetRoll;
      this.heave = targetHeave;
      this.pitchVel = this.rollVel = this.heaveVel = 0;
      this.lastVy = 0;
      this.airborne = airborne;
      this.primed = true;
    } else if (dt > 0) {
      const vy = (groundY - this.lastY) / dt;
      // The landing: down onto the ground after time in the air. The bounce is the fall speed.
      if (this.airborne && !airborne) {
        const impact = Math.min(MAX_LANDING_SPEED, Math.max(0, -this.lastVy));
        this.heaveVel -= LANDING_KICK * impact;
      }
      this.airborne = airborne;
      this.lastVy = vy;

      // In the air the body holds its attitude; only the spring's own motion continues.
      const steps = Math.max(1, Math.ceil(dt / MAX_STEP_S));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        if (!airborne) {
          this.pitchVel += spring(this.pitch, targetPitch, this.pitchVel) * h;
          this.rollVel += spring(this.roll, targetRoll, this.rollVel) * h;
        }
        this.heaveVel += spring(this.heave, airborne ? 0 : targetHeave, this.heaveVel) * h;
        this.pitch += this.pitchVel * h;
        this.roll += this.rollVel * h;
        this.heave = clamp(this.heave + this.heaveVel * h, MAX_HEAVE_M);
      }
    }
    this.lastX = x;
    this.lastY = groundY;
    this.lastZ = z;
  }

  /** Forget the last frame, so the next `update` snaps to the ground instead of springing. */
  reset(): void {
    this.primed = false;
  }
}

/** Critically damped spring acceleration toward `target`. */
function spring(x: number, target: number, v: number): number {
  return OMEGA * OMEGA * (target - x) - 2 * OMEGA * v;
}

function clamp(v: number, limit: number): number {
  return Math.min(limit, Math.max(-limit, v));
}
