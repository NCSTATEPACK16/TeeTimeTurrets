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

/**
 * True when nothing in the terrain rises above the straight line from (fromX, fromY, fromZ) to
 * (toX, toY, toZ).
 *
 * Endpoints are not sampled. Both are expected to sit above the surface -- they are cart and
 * camera positions -- and sampling them would report a cart standing on a ridge as blocked by the
 * ridge it is standing on.
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
): boolean {
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
