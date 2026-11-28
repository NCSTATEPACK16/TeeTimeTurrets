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

/**
 * The first obstacle the flat segment (ax, az) -> (bx, bz) passes through, each rectangle grown by
 * `pad` metres on every side, or -1 when it passes through none. Heights are ignored: this is "can
 * a cart drive straight there", not "can it see there". Allocation-free.
 */
export function firstBlocking(
  obstacles: readonly Obstacle[],
  ax: number,
  az: number,
  bx: number,
  bz: number,
  pad: number,
): number {
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i]!;
    const hx = o.halfX + pad;
    const hz = o.halfZ + pad;
    const px = ax - o.x;
    const pz = az - o.z;
    const qx = bx - o.x;
    const qz = bz - o.z;
    // Into the rectangle's frame, as `clearOfObstacles` does.
    const lax = px * o.cos - pz * o.sin;
    const laz = px * o.sin + pz * o.cos;
    const ldx = qx * o.cos - qz * o.sin - lax;
    const ldz = qx * o.sin + qz * o.cos - laz;
    if (clipSlab(lax, ldx, hx) && clipSlab(laz, ldz, hz) && clipBoth(lax, ldx, hx, laz, ldz, hz)) return i;
  }
  return -1;
}

/** Whether the segment p + t d, t in 0..1, has any t inside -h..h on one axis. */
function clipSlab(p: number, d: number, h: number): boolean {
  if (Math.abs(d) < 1e-12) return p >= -h && p <= h;
  const a = (-h - p) / d;
  const b = (h - p) / d;
  return Math.max(Math.min(a, b), 0) <= Math.min(Math.max(a, b), 1);
}

/** Whether the two axes' inside-intervals overlap inside 0..1: the segment enters the rectangle. */
function clipBoth(px: number, dx: number, hx: number, pz: number, dz: number, hz: number): boolean {
  let t0 = 0;
  let t1 = 1;
  if (Math.abs(dx) >= 1e-12) {
    const a = (-hx - px) / dx;
    const b = (hx - px) / dx;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  if (Math.abs(dz) >= 1e-12) {
    const a = (-hz - pz) / dz;
    const b = (hz - pz) / dz;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  return t0 <= t1;
}

/**
 * Corner `k` (0..3) of obstacle `o` grown by `pad`, in world x/z, written into `out`: the way
 * round a building for a cart that cannot drive through it.
 */
export function obstacleCorner(o: Obstacle, pad: number, k: number, out: { x: number; z: number }): void {
  const lx = (k & 1 ? 1 : -1) * (o.halfX + pad);
  const lz = (k & 2 ? 1 : -1) * (o.halfZ + pad);
  // Back out of the rectangle's frame: the transpose of the rotation `firstBlocking` applies.
  out.x = o.x + lx * o.cos + lz * o.sin;
  out.z = o.z - lx * o.sin + lz * o.cos;
}
