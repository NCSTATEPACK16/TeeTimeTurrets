import type { CartTransform } from "../sim/frame";

/**
 * Chase framing, from image 03: cart low in frame, horizon high, enough lead to read the next
 * hazard. Pure math on plain vectors, so the framing is testable without a renderer.
 *
 * The camera follows the **turret**. It used to follow the chassis, so that swinging the turret
 * swept the golf-club barrel across frame the way image 03 shows it. That held while aiming was
 * a slow key-driven slew. With the mouse aiming the pistol, a chassis camera leaves the player
 * shooting at things off the side of the screen, and the arena is a shooter first.
 */

export const CHASE_DISTANCE = 6.5;
export const CHASE_HEIGHT = 3.6;
export const CHASE_LOOK_AHEAD = 8;
/**
 * The look target sits *below* the cart, not above it. That pitches the camera down, which is
 * what pushes the cart into the lower third of the frame and leaves the horizon high -- image
 * 03's framing. Aiming at or above the cart pitches up and centres it instead.
 */
export const CHASE_LOOK_DROP = 0.3;

export interface MutableVec3 {
  x: number;
  y: number;
  z: number;
}

/** Where the chase eye wants to be and what it wants to look at, for this cart. */
export function chasePose(c: CartTransform, eye: MutableVec3, look: MutableVec3): void {
  const forwardX = Math.cos(c.turretYaw);
  const forwardZ = Math.sin(c.turretYaw);
  eye.x = c.position.x - forwardX * CHASE_DISTANCE;
  eye.y = c.position.y + CHASE_HEIGHT;
  eye.z = c.position.z - forwardZ * CHASE_DISTANCE;
  look.x = c.position.x + forwardX * CHASE_LOOK_AHEAD;
  look.y = c.position.y - CHASE_LOOK_DROP;
  look.z = c.position.z + forwardZ * CHASE_LOOK_AHEAD;
}

/**
 * Lerp factors per 60 Hz frame. Position lags further than the look target so turns read as
 * weight. Stated at 60 Hz because that is what they were tuned at; `chaseSmoothing` turns them
 * into the right factor for any frame length.
 */
export const CHASE_POSITION_LERP = 0.12;
export const CHASE_TARGET_LERP = 0.2;

const TUNED_FRAME_SECONDS = 1 / 60;

/** Vertical field of view at rest, degrees. */
export const CHASE_BASE_FOV = 60;
/** Degrees the view widens by at full speed: the rush of a flat-out cart. */
export const CHASE_FOV_KICK = 12;
/** Forward speed, m/s, at which the whole kick is in. A street cart's top speed on fairway. */
export const CHASE_FOV_FULL_SPEED = 20;

/** The field of view for a cart moving at `speed` m/s. Reversing does not widen it. */
export function chaseFov(speed: number): number {
  const t = Math.min(1, Math.max(0, speed / CHASE_FOV_FULL_SPEED));
  return CHASE_BASE_FOV + CHASE_FOV_KICK * t;
}

/**
 * The fraction of the remaining distance to close in a frame `frameSeconds` long: exponential
 * decay, so the camera settles at the same speed at any frame rate. A fixed per-frame factor
 * made a 144 Hz display's camera nearly three times as stiff as a 60 Hz one.
 */
export function chaseSmoothing(per60HzFrame: number, frameSeconds: number): number {
  return 1 - Math.pow(1 - per60HzFrame, frameSeconds / TUNED_FRAME_SECONDS);
}
/** Points along the sight line the ground is checked at. */
const CLEARANCE_SAMPLES = 12;

/**
 * Lifts `eye` until the line from `look` to it clears the ground by `clearance` at every sample:
 * a bank between the camera and the cart, or a rise behind it, lifts the camera over rather than
 * hiding the cart. Only ever lifts; `frameChase` smooths the result like any other move.
 */
export function clearTerrain(
  eye: MutableVec3,
  look: { readonly x: number; readonly y: number; readonly z: number },
  heightAt: (x: number, z: number) => number,
  clearance: number,
): void {
  let y = eye.y;
  for (let i = 1; i <= CLEARANCE_SAMPLES; i++) {
    const t = i / CLEARANCE_SAMPLES;
    const ground = heightAt(look.x + (eye.x - look.x) * t, look.z + (eye.z - look.z) * t);
    // The line's height at t is look.y + (eye.y - look.y) * t; solve for the eye that clears here.
    const needed = look.y + (ground + clearance - look.y) / t;
    if (needed > y) y = needed;
  }
  eye.y = y;
}
