import type { CartTransform } from "../sim/world";

/**
 * Chase framing, from image 03 and `chase-target-01.jpg`: cart low in frame, horizon high, enough
 * lead to read the next hazard. Pure math on plain vectors, so the framing is testable without a renderer.
 *
 * The camera follows the **turret**. It used to follow the chassis, so that swinging the turret
 * swept the golf-club barrel across frame the way image 03 shows it. That held while aiming was
 * a slow key-driven slew. With the mouse aiming the pistol, a chassis camera leaves the player
 * shooting at things off the side of the screen, and the arena is a shooter first.
 */

/**
 * Framing, retuned in Stage 4 (#51) toward `docs/concept/reference/chase-target-01.jpg` and shot 03
 * (`docs/art/STYLE-RESEARCH.md` P6): lower than it was (3.6 m), a little closer, and set off to the
 * cart's right so the open side, the seat well and the side panel show instead of the canopy's top.
 * Starting values for the user to tune by feel.
 */
export const CHASE_DISTANCE = 6.3;
export const CHASE_HEIGHT = 2.8;
/** To the turret's right, metres. Small enough that the cart stays near the middle of the frame. */
export const CHASE_SIDE = 0.7;
export const CHASE_LOOK_AHEAD = 8;
/**
 * The look target sits *below* the cart, not above it. That pitches the camera down, which is
 * what pushes the cart into the lower half of the frame and leaves the horizon high. 2.15 m below
 * the cart's centre, 14.3 m from the eye, is a 19 degree pitch: with the 60 degree base FOV the
 * horizon sits a fifth of the way down the frame on level ground (P6).
 */
export const CHASE_LOOK_DROP = 2.15;

export interface MutableVec3 {
  x: number;
  y: number;
  z: number;
}

/** Where the chase eye wants to be and what it wants to look at, for this cart, on level ground. */
export function chasePose(c: CartTransform, eye: MutableVec3, look: MutableVec3): void {
  const forwardX = Math.cos(c.turretYaw);
  const forwardZ = Math.sin(c.turretYaw);
  // The turret's right in world XZ: forward x up, which is (-forwardZ, forwardX) with +y up.
  const rightX = -forwardZ;
  const rightZ = forwardX;
  eye.x = c.position.x - forwardX * CHASE_DISTANCE + rightX * CHASE_SIDE;
  eye.y = c.position.y + CHASE_HEIGHT;
  eye.z = c.position.z - forwardZ * CHASE_DISTANCE + rightZ * CHASE_SIDE;
  look.x = c.position.x + forwardX * CHASE_LOOK_AHEAD;
  look.y = c.position.y - CHASE_LOOK_DROP;
  look.z = c.position.z + forwardZ * CHASE_LOOK_AHEAD;
}

/** The eye stays at least this far above the ground directly under it. */
export const CHASE_MIN_GROUND_CLEARANCE = 1.5;
/** And the sight line from the cart's roof to the eye stays this far above the ground it crosses. */
export const CHASE_SIGHT_CLEARANCE = 0.6;
/** The most a rise behind the cart may lift the eye before the camera pulls in instead. */
export const CHASE_MAX_RAISE = 3;
/** The closest a blocked camera pulls in, as a fraction of its distance. */
export const CHASE_MIN_PULL = 0.25;
/** Height of the sight line's cart end above the cart's centre: about the canopy. */
const SIGHT_FROM_CART_M = 1.2;
/** Samples along the cart-to-eye line, and the look-ahead distances along the turret. */
const SIGHT_SAMPLES = 8;
const AHEAD_SAMPLES_M = [4, 8, 12, 16] as const;
/** How much of a rise ahead lifts the look target, and how much of a drop lowers it. */
const AHEAD_RISE_GAIN = 0.7;
const AHEAD_DROP_GAIN = 0.4;

/**
 * `chasePose`'s level-ground answer, fitted to the actual ground (#51). In place, allocation-free:
 * it runs every frame.
 *
 * 1. **Look-ahead.** The look target rises with the highest ground ahead along the turret and falls
 *    (less) with the lowest, so driving at a rise the camera pitches up to see over it instead of
 *    staring into the slope, and cresting one it tips down the far side.
 * 2. **Eye above the ground** under it by `CHASE_MIN_GROUND_CLEARANCE`.
 * 3. **Sight line clear.** Ground between the cart's roof and the eye may not come within
 *    `CHASE_SIGHT_CLEARANCE` of the line. The eye is lifted to clear it, by at most `CHASE_MAX_RAISE`;
 *    past that the camera pulls in toward the cart, to just short of the blocking ground.
 *
 * `cartX/Y/Z` is the cart's centre, as `CartTransform.position`.
 */
export function fitChaseToGround(
  cartX: number,
  cartY: number,
  cartZ: number,
  turretYaw: number,
  heightAt: (x: number, z: number) => number,
  eye: MutableVec3,
  look: MutableVec3,
): void {
  const forwardX = Math.cos(turretYaw);
  const forwardZ = Math.sin(turretYaw);
  const groundAtCart = heightAt(cartX, cartZ);
  let rise = 0;
  let drop = 0;
  for (const d of AHEAD_SAMPLES_M) {
    const delta = heightAt(cartX + forwardX * d, cartZ + forwardZ * d) - groundAtCart;
    if (delta > rise) rise = delta;
    if (delta < drop) drop = delta;
  }
  look.y += AHEAD_RISE_GAIN * rise + AHEAD_DROP_GAIN * drop;

  const baseY = eye.y;
  eye.y = Math.max(eye.y, heightAt(eye.x, eye.z) + CHASE_MIN_GROUND_CLEARANCE);

  const fromY = cartY + SIGHT_FROM_CART_M;
  let pull = 1;
  for (let i = 1; i <= SIGHT_SAMPLES; i++) {
    const t = i / (SIGHT_SAMPLES + 1);
    const x = cartX + (eye.x - cartX) * t;
    const z = cartZ + (eye.z - cartZ) * t;
    const needed = heightAt(x, z) + CHASE_SIGHT_CLEARANCE;
    const lineY = fromY + (eye.y - fromY) * t;
    if (lineY >= needed) continue;
    // The eye height that puts the line exactly at `needed` here.
    const lift = fromY + (needed - fromY) / t;
    if (lift <= baseY + CHASE_MAX_RAISE) {
      eye.y = Math.max(eye.y, lift);
    } else {
      eye.y = Math.max(eye.y, baseY + CHASE_MAX_RAISE);
      pull = Math.min(pull, Math.max(CHASE_MIN_PULL, t * 0.9));
    }
  }
  if (pull < 1) {
    eye.x = cartX + (eye.x - cartX) * pull;
    eye.y = fromY + (eye.y - fromY) * pull;
    eye.z = cartZ + (eye.z - cartZ) * pull;
    eye.y = Math.max(eye.y, heightAt(eye.x, eye.z) + CHASE_MIN_GROUND_CLEARANCE);
  }
}

/**
 * Lerp factors per 60 Hz frame. Position lags further than the look target so turns read as
 * weight. Stated at 60 Hz because that is what they were tuned at; `chaseSmoothing` turns them
 * into the right factor for any frame length.
 */
export const CHASE_POSITION_LERP = 0.12;
export const CHASE_TARGET_LERP = 0.2;

const TUNED_FRAME_SECONDS = 1 / 60;

/**
 * The fraction of the remaining distance to close in a frame `frameSeconds` long: exponential
 * decay, so the camera settles at the same speed at any frame rate. A fixed per-frame factor
 * made a 144 Hz display's camera nearly three times as stiff as a 60 Hz one.
 */
export function chaseSmoothing(per60HzFrame: number, frameSeconds: number): number {
  return 1 - Math.pow(1 - per60HzFrame, frameSeconds / TUNED_FRAME_SECONDS);
}
