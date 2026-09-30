/**
 * Whether one point on the course can see another, tested against the terrain between them.
 *
 * This exists because of a nameplate rule (UI-SPEC H13, and `src/ui/plateState.ts`): an enemy
 * plate must not render through a hill. On a course built entirely out of hills, a plate that
 * ignores terrain hands away every flank, which is most of the reason the course is worth
 * crossing at all.
 *
 * A heightfield march rather than a Rapier raycast, deliberately. The physics world holds carts,
 * the ball, the pin and props, and a ray fired into it would be blocked by a passing cart -- which
 * is not what "can I see that hill through" means. `heightAt` is a pure function of (x, z) and
 * the only thing this question is actually about, so it is the only thing sampled.
 *
 * Pure, and free of Rapier and three, so it runs in the node suite like the rest of `src/sim/**`.
 */

/**
 * A building as a sight-line blocker: an oriented rectangle in x/z, from the ground up to `top`
 * (world y). `cos`/`sin` are of the yaw that turns the rectangle's local axes into the world's,
 * precomputed so a query does no trigonometry. Built by `clubhouseObstacles`.
 */
export interface Obstacle {
  readonly x: number;
  readonly z: number;
  readonly halfX: number;
  readonly halfZ: number;
  readonly cos: number;
  readonly sin: number;
  readonly top: number;
}

/** The structural slice of Terrain this needs. Structural so tests need no real heightfield. */
export interface HeightSampler {
  heightAt(x: number, z: number): number;
}

/** Metres between samples along the ray. One sample per two metres resolves a ridge the cart
 *  could not drive over anyway, and keeps a 300 m sight line at 150 samples. */
export const LOS_STEP_M = 2;

/** Upper bound on samples, so a pathological distance cannot stall the frame. At `LOS_STEP_M`
 *  this is a 1,000 m sight line, comfortably past the range any plate still draws a number at. */
export const LOS_MAX_SAMPLES = 500;

const NO_OBSTACLES: readonly Obstacle[] = [];

/**
 * True when the straight line from (fromX, fromY, fromZ) to (toX, toY, toZ) passes through no
 * obstacle below its top. The ray is clipped to each rectangle in the rectangle's own frame and
 * is blocked when it is under the top anywhere inside it, which, the ray being straight, is at one
 * of the two ends of the clipped piece. An endpoint inside a rectangle is inside the building:
 * a cart parked in a barn is hidden from everyone, and sees no one.
 *
 * Allocation-free, and a handful of multiplies per obstacle: bots ask it every tick.
 */
export function clearOfObstacles(
  obstacles: readonly Obstacle[],
  fromX: number,
  fromY: number,
  fromZ: number,
  toX: number,
  toY: number,
  toZ: number,
): boolean {
  const dy = toY - fromY;
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i]!;
    // Into the rectangle's frame: the inverse of the yaw the renderer placed it with.
    const ax = fromX - o.x;
    const az = fromZ - o.z;
    const bx = toX - o.x;
    const bz = toZ - o.z;
    const lax = ax * o.cos - az * o.sin;
    const laz = ax * o.sin + az * o.cos;
    const ldx = bx * o.cos - bz * o.sin - lax;
    const ldz = bx * o.sin + bz * o.cos - laz;
    let t0 = 0;
    let t1 = 1;
    // Slab clip, x then z.
    if (Math.abs(ldx) < 1e-12) {
      if (lax < -o.halfX || lax > o.halfX) continue;
    } else {
      let a = (-o.halfX - lax) / ldx;
      let b = (o.halfX - lax) / ldx;
      if (a > b) {
        const swap = a;
        a = b;
        b = swap;
      }
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      if (t0 > t1) continue;
    }
    if (Math.abs(ldz) < 1e-12) {
      if (laz < -o.halfZ || laz > o.halfZ) continue;
    } else {
      let a = (-o.halfZ - laz) / ldz;
      let b = (o.halfZ - laz) / ldz;
      if (a > b) {
        const swap = a;
        a = b;
        b = swap;
      }
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      if (t0 > t1) continue;
    }
    if (Math.min(fromY + dy * t0, fromY + dy * t1) < o.top) return false;
  }
  return true;
}

/**
 * True when nothing in the terrain rises above the straight line from (fromX, fromY, fromZ) to
 * (toX, toY, toZ).
 *
 * Endpoints are not sampled. Both are expected to sit above the surface -- they are cart and
 * camera positions -- and sampling them would report a cart standing on a ridge as blocked by the
 * ridge it is standing on.
 *
 * `obstacles`, when given, are buildings that block the line too (`clearOfObstacles`).
 *
 * Grazing counts as visible: terrain exactly at the ray's height does not block. The comparison is
 * strict so a perfectly flat course, where the ray between two carts at equal height runs parallel
 * to the ground, does not read as blocked along its entire length.
 */
export function hasLineOfSight(
  terrain: HeightSampler,
  fromX: number,
  fromY: number,
  fromZ: number,
  toX: number,
  toY: number,
  toZ: number,
  obstacles: readonly Obstacle[] = NO_OBSTACLES,
): boolean {
  if (!clearOfObstacles(obstacles, fromX, fromY, fromZ, toX, toY, toZ)) return false;
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const flat = Math.hypot(dx, dz);
  if (flat <= LOS_STEP_M) return true;

  const steps = Math.min(LOS_MAX_SAMPLES, Math.ceil(flat / LOS_STEP_M));
  const dy = toY - fromY;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (terrain.heightAt(fromX + dx * t, fromZ + dz * t) > fromY + dy * t) return false;
  }
  return true;
}
