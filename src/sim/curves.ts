/**
 * The blend curve the whole course is shaped with, and its inverse.
 *
 * A leaf module with no imports, which is the point of it existing separately from `terrain.ts`.
 * `crossing.ts` needs the same curve for its shoulders, `terrain.ts` needs it for pads and
 * shorelines, and `terrain.ts` needs `crossing.ts` for the causeway -- so leaving the curve in
 * `terrain.ts` makes those two modules a cycle. `terrain.ts` re-exports both names, so every
 * existing importer is unaffected.
 */

/** Smoothstep: C1-continuous, so a pad edge has no slope discontinuity ring. */
export function smoothstep01(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/**
 * The inverse of `smoothstep01`: given a weight, the parameter that produces it.
 *
 * Closed form via the trigonometric solution to the depressed cubic `3c^2 - 2c^3 = y`. Exists so
 * a caller that knows a *weight* it cares about -- "where does the rough get deep enough to plant
 * trees" -- can turn that into a *distance* without hard-coding a number that would silently stop
 * matching if the blend ever changed shape.
 */
export function inverseSmoothstep01(y: number): number {
  const clamped = Math.min(1, Math.max(0, y));
  return 0.5 - Math.sin(Math.asin(1 - 2 * clamped) / 3);
}
