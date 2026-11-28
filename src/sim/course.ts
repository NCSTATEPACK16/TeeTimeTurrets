/**
 * The course data model. Plain data: DOM-free, no Rapier, no Three.
 *
 * A course is nine holes, not one nine-hole map. Each HoleSpec owns its own field, terrain and
 * surfaces, and playing a round loads one at a time -- which is what makes "multiple courses,
 * one selected at a time" fall out of the data model instead of needing streaming, chunking, or
 * a level format. A second course is a second list.
 */

import { BLEND_WIDTH, GREEN_RADIUS, HALF_WIDTH, halfWidthAt } from "./terrain";
import type { Terrain } from "./terrain";
import type { MutableVec2 } from "./spline";
import { isWaterAt } from "./hazards";
import type { Ellipse, Polygon } from "./hazards";
import { DRIVER_CARRY_M, REFERENCE_CARRY_M } from "./carry";
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
// The ids are historical. Since 15 Nov 2026 the three are variations of one Piedmont pine
// course -- pine upland, open upland, bottomland -- and not three climates: see `render/biomes.ts`.
// Renaming them is left to the refactor stage, because the briefs and committed plans use them.
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
  /** From the scorecard (`authoredCourse.ts`); 3 on `fixedHoleSpec`. */
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
 * One hand-built hole. Not generated: it is the deterministic spec that `world.cart.test.ts`
 * and the probe run against, so a cart or ballistics regression is never confused with a
 * different course.
 *
 * Its geometry is a legal hole -- tee and cup inside the corridor box for a 160 m field, a
 * dog-leg apex, and a 90 m tee-to-cup separation -- so it passes the §6 checks rather than
 * merely existing. `par` is 3: the corridor is ~105 m, under one REFERENCE_CARRY_M.
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
    // Holes with hazards are exercised by the generator's own tests.
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

/** A 20 m par 3 is not a hole. */
export const MIN_HOLE_LENGTH = 60;

/** Clearance between the corridor's outer edge and the field boundary. */
export const EDGE_MARGIN = 6;


/** Slope ceilings, as tan(theta). Written as expressions so the degrees stay readable. */
export const MAX_LONGITUDINAL_GRAD = Math.tan((6.27 * Math.PI) / 180);
export const MAX_CAMBER_GRAD = Math.tan((4.0 * Math.PI) / 180);
export const MAX_GREEN_GRAD = Math.tan((3.43 * Math.PI) / 180);

/** Centreline sampling interval for checks 2, 3, 4 and 6. */
const CENTRELINE_SAMPLE_M = 1.0;

export interface HoleRejection {
  /** Which numbered check failed, matching the spec's table. */
  readonly check: number;
  readonly reason: string;
}

/**
 * The seven playability checks, run against a candidate and its terrain. Returns the first
 * failure or null.
 *
 * Only the corridor and the green are policed. The rough runs unbudgeted on purpose (see
 * GRAD_ROUGH in terrain.ts): a ball on a steep rough patch is *supposed* to keep rolling out
 * onto flatter ground rather than parking on a hillside.
 *
 * Cheap geometric checks run first so a hopeless candidate is rejected before any terrain is
 * sampled.
 *
 * Checks 2 (the centreline stays in the field's box) and 7 (no longer than three driver shots)
 * were the drafting limits of the procedural generator. The authored course was laid out to a
 * real card rather than to them, and its holes break both, so `draftingLimits: false` skips
 * those two and judges the playing surface alone: grade, camber, the green and the water.
 */
export function validateHole(
  spec: HoleSpec,
  terrain: Terrain,
  options: { readonly draftingLimits?: boolean } = {},
): HoleRejection | null {
  const drafting = options.draftingLimits ?? true;
  const spline = terrain.spline;

  const separation = Math.hypot(spec.cup.x - spec.tee.x, spec.cup.z - spec.tee.z);
  if (separation < MIN_HOLE_LENGTH) {
    return {
      check: 1,
      reason: `tee-to-cup ${separation.toFixed(1)} m is under the ${MIN_HOLE_LENGTH} m minimum`,
    };
  }

  const reachLimit = 3 * REFERENCE_CARRY_M;
  if (drafting && spline.length > reachLimit) {
    return {
      check: 7,
      reason: `corridor ${spline.length.toFixed(1)} m exceeds three driver shots (${reachLimit} m)`,
    };
  }

  const wet = (x: number, z: number): boolean => isWaterAt(spec, x, z);

  // Check 6, first half: somewhere to stand. Cheap, and it catches a tee drawn into a lake
  // before any run accounting.
  //
  // There is deliberately no matching check on the cup. The green wins over water in `isWaterAt`,
  // so a cup is dry by construction -- and a green ringed by water is not a defect, it is hole
  // 13. What makes an over-watered green unplayable is the *carry* it demands, and that is the
  // wet-run rule below, which measures the thing that actually matters.
  if (wet(spec.tee.x, spec.tee.z)) {
    return { check: 6, reason: "the tee is inside a water hazard" };
  }

  const room = corridorBox(spec.fieldSize, spec.corridor);
  const steps = Math.max(2, Math.ceil(spline.length / CENTRELINE_SAMPLE_M));
  const tangent: MutableVec2 = { x: 0, z: 0 };
  let previousX = 0;
  let previousZ = 0;
  let previousHeight = 0;
  let previousWet = false;
  // Check 6, second half. Walk the centreline accumulating the length of each contiguous wet
  // run; the longest one is the carry the hole demands.
  let wetRun = 0;
  let longestWetRun = 0;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = spline.pointAt(t);
    const height = terrain.heightAt(p.x, p.z);
    const here = wet(p.x, p.z);

    if (drafting && (Math.abs(p.x) > room || Math.abs(p.z) > room)) {
      return {
        check: 2,
        reason: `centreline reaches (${p.x.toFixed(1)}, ${p.z.toFixed(1)}), outside the ${room.toFixed(1)} m box`,
      };
    }

    if (i > 0) {
      const run = Math.hypot(p.x - previousX, p.z - previousZ);

      if (here || previousWet) {
        wetRun += run;
        if (wetRun > longestWetRun) longestWetRun = wetRun;
      } else {
        wetRun = 0;
      }

      // Checks 3 and 4 are about whether the *playing surface* is fair, and water is not a
      // playing surface. The bank of a legal crossing is a cliff by design -- WATER_DEPTH over
      // WATER_SHORE is a 0.25 grade against check 3's 0.11 limit -- so sampling across it would
      // reject every forced carry as a slope defect rather than judging it as a carry, which is
      // check 6's job.
      if (!here && !previousWet && run > 1e-6) {
        const grade = Math.abs(height - previousHeight) / run;
        if (grade > MAX_LONGITUDINAL_GRAD) {
          return {
            check: 3,
            reason: `longitudinal grade ${grade.toFixed(4)} at t=${t.toFixed(3)} exceeds ${MAX_LONGITUDINAL_GRAD.toFixed(4)}`,
          };
        }
      }
    }
    previousX = p.x;
    previousZ = p.z;
    previousHeight = height;
    previousWet = here;

    if (here) continue;

    // Each side is measured against the centreline separately rather than across the full
    // width: averaging the two banks lets an asymmetric bowl cancel itself out and pass.
    spline.tangentInto(t, tangent);
    const normalX = -tangent.z;
    const normalZ = tangent.x;
    // The arm follows the corridor's own width here, rather than the hole's widest point. The
    // check asks whether the *mown surface* is cambered, so it has to sample at the mown edge:
    // a fixed arm on a hole that pinches to 10 m would be measuring the rough and rejecting
    // every narrow hole as a camber defect. Half a blend band past the edge is the same relative
    // position the fixed 20 m arm used to sit at when every corridor was 15 m wide.
    const arm = halfWidthAt(spec.corridor, t) + BLEND_WIDTH / 2;
    for (const side of [-1, 1]) {
      const armX = p.x + normalX * arm * side;
      const armZ = p.z + normalZ * arm * side;
      // Same reasoning as above: a bank beside the corridor is a hazard's edge, not camber.
      if (wet(armX, armZ)) continue;
      const camber = Math.abs(terrain.heightAt(armX, armZ) - height) / arm;
      if (camber > MAX_CAMBER_GRAD) {
        return {
          check: 4,
          reason: `lateral camber ${camber.toFixed(4)} at t=${t.toFixed(3)} exceeds ${MAX_CAMBER_GRAD.toFixed(4)}`,
        };
      }
    }
  }

  if (longestWetRun > DRIVER_CARRY_M) {
    return {
      check: 6,
      reason:
        `a ${longestWetRun.toFixed(1)} m water crossing exceeds the driver's ` +
        `${DRIVER_CARRY_M} m carry`,
    };
  }

  // Sampled in the green's own frame, so an elongated green is policed to its ends rather than
  // only inside the largest circle that fits in it. `fraction` walks out to the rim along each
  // ray; scaling by the axes turns that into a point on the actual putting surface.
  const green = spec.green;
  const cos = Math.cos(green.rotation);
  const sin = Math.sin(green.rotation);
  const rings = Math.max(2, Math.ceil(Math.max(green.radiusX, green.radiusZ)));
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 24) {
    for (let ring = 1; ring <= rings; ring += 1) {
      const fraction = ring / rings;
      const localX = Math.cos(angle) * green.radiusX * fraction;
      const localZ = Math.sin(angle) * green.radiusZ * fraction;
      const x = green.x + localX * cos - localZ * sin;
      const z = green.z + localX * sin + localZ * cos;
      const dx = (terrain.heightAt(x + 0.5, z) - terrain.heightAt(x - 0.5, z)) / 1.0;
      const dz = (terrain.heightAt(x, z + 0.5) - terrain.heightAt(x, z - 0.5)) / 1.0;
      const grade = Math.hypot(dx, dz);
      if (grade > MAX_GREEN_GRAD) {
        return {
          check: 5,
          reason:
            `green grade ${grade.toFixed(4)} at (${x.toFixed(1)}, ${z.toFixed(1)}), ` +
            `${(fraction * 100).toFixed(0)}% out to the green's rim, exceeds ${MAX_GREEN_GRAD.toFixed(4)}`,
        };
      }
    }
  }

  return null;
}

/**
 * Corridor length bands, in metres -- **validation bounds, not a generator's choice.**
 *
 * These were the bands a procedural drafter sampled inside, and they were sized for a course about
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
 * generator's field-per-par table could not fit the real card at all: a 220 m par-4 field has a
 * 311 m diagonal against a 370 m par 4, so the longest holes fitted at no bearing.
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

/**
 * The half-width of the square the centreline must stay inside, measured from the field's centre.
 *
 * The widest half-width the hole authorises, so the box is the one the *whole* corridor has to fit
 * inside rather than the one its narrowest point would allow.
 *
 * `validateHole` check 2 rejects a centreline that leaves this box. It is a drafting limit of the
 * deleted generator, which picked bearings to stay inside it; the authored holes are sized by
 * `fieldSizeFor` instead and are validated with `draftingLimits: false`.
 */
export function corridorBox(fieldSize: number, corridor: readonly number[]): number {
  return fieldSize / 2 - (Math.max(...corridor) + BLEND_WIDTH) - EDGE_MARGIN;
}
