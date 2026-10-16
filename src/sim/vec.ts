/**
 * Small scalar and XZ-plane helpers the sim shares, instead of each module keeping its own copy.
 *
 * Allocation-free: everything takes and returns plain numbers, so any of it is safe inside
 * `Sim.step`. DOM-free and three-free like the rest of `src/sim`, and imports nothing, so it can
 * sit upstream of every module without making an import cycle.
 */

/** `v` pinned to `[lo, hi]`. Written as a comparison chain, not `Math.min(Math.max(...))`. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** `v` pinned to `[0, 1]`. */
export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Folds an angle into [-PI, PI], so an error either side of the wrap turns the short way. */
export function wrapAngle(radians: number): number {
  return Math.atan2(Math.sin(radians), Math.cos(radians));
}

/**
 * Squared distance from (px, pz) to the segment (ax, az) -> (bx, bz) in the XZ plane, measured
 * to the nearest point on it, so beyond either end it is the distance to that end. A zero-length
 * segment is its one point.
 */
export function segmentDistanceSq(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const ex = bx - ax;
  const ez = bz - az;
  const lengthSq = ex * ex + ez * ez;
  const t = lengthSq > 0 ? clamp01(((px - ax) * ex + (pz - az) * ez) / lengthSq) : 0;
  const dx = px - (ax + ex * t);
  const dz = pz - (az + ez * t);
  return dx * dx + dz * dz;
}
