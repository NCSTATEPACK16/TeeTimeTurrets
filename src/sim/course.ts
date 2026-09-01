/**
 * The course data model. Plain data: DOM-free, no Rapier, no Three, no imports at all yet.
 *
 * A course is nine holes, not one nine-hole map. Each HoleSpec owns its own field, terrain and
 * surfaces, and playing a round loads one at a time -- which is what makes "multiple courses,
 * one selected at a time" fall out of the data model instead of needing streaming, chunking, or
 * a level format. A second course is a second list.
 */

export interface Vec2 {
  readonly x: number;
  readonly z: number;
}

/**
 * Mutable on purpose: this is the shape the sim passes around as reusable scratch, per the
 * no-allocation-in-the-hot-loop rule. `Vec2` is immutable because it is spec data.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface HoleSpec {
  /** uint32. Every derived noise channel and layout choice hashes from this. */
  readonly seed: number;
  /**
   * 0-based position within the course. Part of the channel hash, so hole 3 of two different
   * courses with the same course seed still differ.
   */
  readonly index: number;
  /** Square field, metres. Per-hole rather than global -- a par 5 needs more room. */
  readonly fieldSize: number;
  /**
   * Heightfield rows == cols. Cell size is fieldSize / cells and must stay near 1.0 m: a
   * coarser cell makes triangle seams big enough for the 0.15 m ball to trip over.
   */
  readonly cells: number;
  readonly tee: Vec2;
  readonly cup: Vec2;
  /**
   * Corridor centreline control points, tee first and cup last, length >= 3. Interior points
   * are dog-leg apexes.
   */
  readonly control: readonly Vec2[];
  /** Derived from corridor length by generateHole. Never authored. */
  readonly par: number;
  readonly waterLevel: number;
}

export interface Course {
  readonly id: string;
  readonly name: string;
  readonly seed: number;
  readonly holes: readonly HoleSpec[];
}

/** Arbitrary but fixed, so `fixedHoleSpec()` is the same hole on every machine and every run. */
const FIXED_HOLE_SEED = 0x7ee71e5;

/**
 * One hand-built hole. Not generated: it is the deterministic spec that `world.cart.test.ts`
 * and the probe run against, so a cart or ballistics regression is never confused with a
 * different draw from the generator.
 *
 * Its geometry is a legal hole -- tee and cup inside the corridor box for a 160 m field, a
 * dog-leg apex, and a 90 m tee-to-cup separation -- so it passes the §6 checks rather than
 * merely existing. `par` is 3 by the same formula generateHole uses: the corridor is ~105 m,
 * under one REFERENCE_CARRY_M.
 */
export function fixedHoleSpec(): HoleSpec {
  const tee: Vec2 = { x: -45, z: 0 };
  const cup: Vec2 = { x: 45, z: 8 };
  return {
    seed: FIXED_HOLE_SEED,
    index: 0,
    fieldSize: 160,
    cells: 160,
    tee,
    cup,
    control: [tee, { x: 0, z: -25 }, cup],
    par: 3,
    waterLevel: -0.72,
  };
}
