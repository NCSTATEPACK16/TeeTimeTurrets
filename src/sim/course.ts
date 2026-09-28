/**
 * The course data model. Plain data: DOM-free, no Rapier, no Three.
 *
 * Each HoleSpec owns its own field, terrain and surfaces in its own local frame. The shipped
 * course is eighteen authored specs (`authoredCourse.ts`) placed into one contiguous world by
 * `courseWorld.ts`, using the offsets in `authoredLayout.ts`.
 */

import { BLEND_WIDTH, GREEN_RADIUS, HALF_WIDTH } from "./terrain";
import type { Ellipse, Polygon } from "./hazards";
import { hashChannel, mulberry32 } from "./rng";

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

/**
 * Which set of colours and props a hole is dressed in.
 *
 * Three, not eighteen. The superseded shot list gave every hole its own climate -- pine forest,
 * seaside cliff, desert canyon, alpine, tropical, volcanic, snowy, bamboo, redwood, mesa -- which
 * reads as a theme park rather than a course and costs eighteen palettes and prop sets. Contiguous
 * stretches give the round a sense of place and travel for a third of the asset bill. See
 * docs/COURSE_PIPELINE.md section 4.
 *
 * This is render-only: nothing in the simulation branches on it, so a biome change can never
 * alter a ball's trajectory or a hole's playability.
 */
export type BiomeId = "parkland" | "links" | "marsh";

/**
 * The course bible's routing, hole 1 to hole 18. Parkland opens, links takes the middle, marsh
 * carries the hard stretch, and parkland returns for the closing three -- so three palettes cover
 * four stretches.
 */
const BIOME_ROUTING: readonly BiomeId[] = [
  "parkland", "parkland", "parkland", "parkland", "parkland",
  "links", "links", "links", "links", "links", "links",
  "marsh", "marsh", "marsh", "marsh",
  "parkland", "parkland", "parkland",
];

/** Cycled past the eighteenth hole, and tolerant of a negative index. */
export function biomeForIndex(index: number): BiomeId {
  const n = BIOME_ROUTING.length;
  return BIOME_ROUTING[((index % n) + n) % n]!;
}

/**
 * How far the mowing direction may swing off the tee-to-cup line, in radians (22.5 degrees).
 *
 * The angle tracks the playing line rather than being drawn freely, because that is what makes
 * the bands run *across* the fairway -- the look in concept images 03 and 05. A freely random
 * angle produces stripes at an arbitrary diagonal to the hole, which reads as a texture rather
 * than as mowing. The jitter exists so eighteen fairways are not mown identically relative to
 * their own lines.
 */
export const STRIPE_JITTER = Math.PI / 8;

/**
 * Channel 4 of the spec's seed -- see the channel table in the design spec's section 3
 * "Seeding". 0 is height, 1 is sand, 2 is the layout draw, 3 is prop scatter.
 */
export function stripeAngleFor(seed: number, index: number, tee: Vec2, cup: Vec2): number {
  const bearing = Math.atan2(cup.z - tee.z, cup.x - tee.x);
  const random = mulberry32(hashChannel(seed, index, 4));
  return bearing + (random() * 2 - 1) * STRIPE_JITTER;
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
  /** From the scorecard (`AUTHORED_HOLES`), checked against `CORRIDOR_BAND`. */
  readonly par: number;
  /**
   * The height the water surface renders at, and the floor a water basin is carved down to.
   *
   * **No longer a classifier.** Until Tier 2 this was the whole definition of water -- any point
   * whose terrain fell below it was wet -- which drowned 37.5% of the course (§5.1). Water is now
   * `water` below, and this is only an elevation.
   */
  readonly waterLevel: number;
  /**
   * Placed water. Empty on a dry hole, and eleven of the eighteen briefs ask for exactly that.
   * See `hazards.ts` and docs/COURSE_PIPELINE.md §5.
   */
  readonly water: readonly Polygon[];
  /** Placed bunkers. Replaces the noise scatter that produced tan confetti across every fairway. */
  readonly bunkers: readonly Ellipse[];
  /**
   * The putting surface. An ellipse rather than `GREEN_RADIUS` about the cup, so a green can be
   * long-and-narrow or set at an angle to the approach. The cup sits inside it but need not sit
   * at its centre -- that is what a pin position is.
   */
  readonly green: Ellipse;
  /**
   * Corridor half-width in metres, one per entry in `control`, interpolated along the spline.
   *
   * Replaces the global `HALF_WIDTH`. This is the combat axis from the briefs made geometric: a
   * hole can now pinch through its landing zone and reopen at the green.
   */
  readonly corridor: readonly number[];
  /** Render-only. Which palette and prop set dresses this hole. See `biomeForIndex`. */
  readonly biome: BiomeId;
  /** Render-only. Mowing direction in radians; bands run perpendicular to it. */
  readonly stripeAngle: number;
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
 * One hand-built hole: the deterministic spec that `world.cart.test.ts` and the probe run
 * against, so a cart or ballistics regression is never confused with a change to the course.
 *
 * Its geometry is a legal hole -- tee and cup inside the corridor box for a 160 m field, a
 * dog-leg apex, and a 90 m tee-to-cup separation -- so it passes `validateHole`'s checks rather
 * than merely existing. `par` is 3: the corridor is ~105 m, under one REFERENCE_CARRY_M.
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
    // Deliberately hazard-free. This fixture is what the cart, ballistics and probe suites run
    // against, so a physics regression is never confused with a hazard landing under the ball.
    // Holes with hazards are exercised by the authored course's tests.
    water: [],
    bunkers: [],
    green: defaultGreen(cup),
    corridor: [HALF_WIDTH, HALF_WIDTH, HALF_WIDTH],
    biome: biomeForIndex(0),
    stripeAngle: stripeAngleFor(FIXED_HOLE_SEED, 0, tee, cup),
  };
}

/**
 * A circular green of the legacy `GREEN_RADIUS` about the cup.
 *
 * The shape every hole had before Tier 2, kept as the neutral default so a spec that does not
 * care about green shape reads the same as it always did -- and so any hole that *does* differ
 * differs because something placed it, not because a default drifted.
 */
/**
 * Re-exported from `hazards.ts`, where it now lives so `crossing.ts` can use it without making
 * `course.ts` and `terrain.ts` a value cycle. Still the single definition; see its docstring for
 * why the green clause is load-bearing.
 */
export { isWaterAt } from "./hazards";

export function defaultGreen(cup: Vec2): Ellipse {
  return {
    x: cup.x,
    z: cup.z,
    radiusX: GREEN_RADIUS,
    radiusZ: GREEN_RADIUS,
    rotation: 0,
  };
}

/**
 * Corridor length bands, in metres -- **validation bounds for the authored card.**
 *
 * These began as the bands a procedural drafter (deleted in Stage 9) sampled inside, sized for a course about
 * two-thirds real length: **not one of the eighteen holes on the real card this course is now
 * traced from was legal under the old numbers** -- every one of them longer than its band's
 * maximum. The old par-4 *minimum* was 135 m, which is 147.6 yd: shorter than three of the card's
 * four par 3s, and the bands overlapped a real par 3 with a real par 4 rather than separating them.
 * Widened to admit a real US card with margin either side, and kept only so that an authored `58`
 * where `580` was meant fails loudly instead of shipping.
 *
 * In yards, for comparison against a scorecard: par 3 is 120-230, par 4 is 260-470, par 5 is
 * 420-620.
 *
 * `authoredCourse` is what makes "fails loudly" true: it measures every authored corridor's arc
 * length against this band and throws. A bound with no consumer is a comment, not a check.
 */
export const CORRIDOR_BAND: Readonly<Record<number, { min: number; max: number }>> = {
  3: { min: 110, max: 210 },
  4: { min: 238, max: 430 },
  5: { min: 384, max: 567 },
};

/**
 * The square a hole's terrain is built in, derived from the corridor it actually has to hold.
 *
 * Per-hole rather than per-par, because the card's range is 147 to 508 yards and one square that
 * fits the longest would make every par 3 carry three times the heightfield it needs. The old
 * per-par squares (160/220/300 m, deleted with the generator) could not fit the real card at all: a 220 m par-4 field has a 311 m diagonal against a 370 m
 * par 4, so the longest holes fitted at no bearing.
 *
 * Sized off the largest `|x|` or `|z|` any control point reaches rather than off `max - min`, so
 * the result holds the corridor whether or not the authored points happen to centre on the origin.
 * The corridor's widest half-width and a blend band are added on each side: terrain stops carving
 * at `half + BLEND_WIDTH`, so a field any tighter would clip its own hole.
 */
export function fieldSizeFor(control: readonly Vec2[], corridor: readonly number[]): number {
  let reach = 0;
  for (const p of control) {
    const r = Math.max(Math.abs(p.x), Math.abs(p.z));
    if (r > reach) reach = r;
  }
  let widest = 0;
  for (const half of corridor) {
    if (half > widest) widest = half;
  }
  return Math.ceil(2 * (reach + widest + BLEND_WIDTH));
}
