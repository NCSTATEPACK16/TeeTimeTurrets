/**
 * The course data model. Plain data: DOM-free, no Rapier, no Three.
 *
 * A course is nine holes, not one nine-hole map. Each HoleSpec owns its own field, terrain and
 * surfaces, and playing a round loads one at a time -- which is what makes "multiple courses,
 * one selected at a time" fall out of the data model instead of needing streaming, chunking, or
 * a level format. A second course is a second list.
 */

import { BLEND_WIDTH, GREEN_RADIUS, HALF_WIDTH, createTerrain, halfWidthAt } from "./terrain";
import type { Terrain } from "./terrain";
import { createSpline } from "./spline";
import type { MutableVec2 } from "./spline";
import { pointInEllipse, pointInPolygon } from "./hazards";
import type { Ellipse, Polygon } from "./hazards";
import { DRIVER_CARRY_M, REFERENCE_CARRY_M } from "./carry";
import { hashChannel, mulberry32 } from "./rng";
import { briefForHole } from "./briefs";
import { corridorFor, placeBunkers, placeWater } from "./placement";

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

/** Cycled for courses that are not eighteen holes, the way `parForIndex` cycles the par mix. */
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
  /** Derived from corridor length by generateHole. Never authored. */
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
 * Whether a point is water. **The single definition** -- `surfaces.surfaceAt` and
 * `validateHole` both call this rather than each testing the polygons themselves.
 *
 * The green clause is what makes that sharing necessary rather than merely tidy. Hole 13's island
 * green is a green sitting *inside* a water polygon: polygons here have no holes, so the moat is
 * drawn solid and the green is punched out of it by classification order. A validator that tested
 * the polygons directly would find the cup inside water and reject the hole -- the archetype would
 * have been unbuildable, and the failure would have looked like a placement bug rather than a
 * disagreement about what "water" means.
 */
export function isWaterAt(spec: HoleSpec, x: number, z: number): boolean {
  if (pointInEllipse(x, z, spec.green)) return false;
  for (const poly of spec.water) {
    if (pointInPolygon(x, z, poly)) return true;
  }
  return false;
}

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


/** Deterministic and bounded, never an unbounded search. */
export const MAX_ATTEMPTS = 32;

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
 * Par is derived, never authored: one full driver per stroke over par 3.
 *
 *   par = clamp(3 + floor(corridorLength / REFERENCE_CARRY_M), 3, 5)
 */
export function derivePar(corridorLength: number): number {
  return Math.min(5, Math.max(3, 3 + Math.floor(corridorLength / REFERENCE_CARRY_M)));
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
 */
export function validateHole(spec: HoleSpec, terrain: Terrain): HoleRejection | null {
  const spline = terrain.spline;

  const separation = Math.hypot(spec.cup.x - spec.tee.x, spec.cup.z - spec.tee.z);
  if (separation < MIN_HOLE_LENGTH) {
    return {
      check: 1,
      reason: `tee-to-cup ${separation.toFixed(1)} m is under the ${MIN_HOLE_LENGTH} m minimum`,
    };
  }

  const reachLimit = 3 * REFERENCE_CARRY_M;
  if (spline.length > reachLimit) {
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

  // The widest half-width the hole authorises, so check 2's box is the box the *whole* corridor
  // has to fit inside rather than the one its narrowest point would allow.
  const widest = Math.max(...spec.corridor);
  const room = spec.fieldSize / 2 - (widest + BLEND_WIDTH) - EDGE_MARGIN;
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

    if (Math.abs(p.x) > room || Math.abs(p.z) > room) {
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
 * The course bible's card: par 36 out, 36 in, 72 around. See docs/COURSE_PIPELINE.md section 4.
 *
 * Eighteen entries rather than a nine-hole mix cycled twice, which is what this was. Both nines
 * sum to 36 either way, so the difference is not the total -- it is that a player walking the
 * back nine should not be replaying the front nine's rhythm hole for hole. The back opens on a
 * par 5 at 11 where the front opens on a par 5 at 4, and its short holes fall at 13 and 16
 * rather than at 2 and 6.
 *
 * Cycled for courses that are not eighteen holes, so a nine-hole round is the front nine and a
 * longer course repeats rather than erroring.
 */
const PAR_MIX: readonly number[] = [
  4, 3, 4, 5, 4, 3, 4, 4, 5, // out -- 36
  4, 5, 4, 3, 4, 4, 3, 4, 5, // in  -- 36
];

export function parForIndex(index: number): number {
  return PAR_MIX[((index % PAR_MIX.length) + PAR_MIX.length) % PAR_MIX.length];
}

/**
 * Field size scales with the par being aimed at, which is why fieldSize lives on HoleSpec
 * rather than being global. `cells` tracks it to hold the cell near 1.0 m: a coarser cell makes
 * heightfield triangle seams large enough for the 0.15 m ball to trip over.
 */
export const FIELD_FOR_PAR: Readonly<Record<number, number>> = { 3: 160, 4: 220, 5: 300 };

/**
 * Corridor length bands, chosen so derivePar returns the par the field was sized for.
 *
 * Exported so `briefs.test.ts` can check an authored corridor half-width against the run it
 * leaves room for, rather than restating these numbers -- a second copy of a band table is the
 * contradictory-source-of-truth failure AGENTS.md warns about, and it would silently stop
 * checking anything the moment one copy moved.
 */
export const CORRIDOR_BAND: Readonly<Record<number, { min: number; max: number }>> = {
  3: { min: 70, max: 125 },
  4: { min: 135, max: 250 },
  5: { min: 265, max: 375 },
};

/** How much of the usable box a straight run and a dog-leg apex are allowed to consume. */
const STRAIGHT_FILL = 0.92;
const APEX_FILL = 0.85;

/**
 * One candidate layout, before validation. Deterministic in (courseSeed, index, par, attempt).
 *
 * Target-first: draw the corridor length, take whatever straight distance the box allows along
 * a random bearing, then SOLVE for the apex offset that makes up the difference. Drawing the
 * apex directly instead lets the worst case fall short of its band -- a par 5 in a 300 m field
 * aligned with an axis has only 238 m of straight available and needs a ~75 m dog-leg to reach
 * 265 m. This is the sense in which the dog-leg is load-bearing rather than decorative.
 *
 * Exported so `npm run probe` can measure the acceptance rate: calling generateHole and
 * counting throws measures whether a *course* can be built, which is a different and much
 * coarser question than what fraction of candidates are playable.
 */
export function draftHole(
  courseSeed: number,
  index: number,
  par: number,
  attempt: number,
): HoleSpec {
  const seed = hashChannel(courseSeed, index, attempt);
  const random = mulberry32(hashChannel(seed, index, 2));
  const brief = briefForHole((index % 18) + 1);
  const corridor = corridorFor(brief, 3);

  const fieldSize = FIELD_FOR_PAR[par];
  // The box shrinks with the corridor, because a wider mown surface needs more room beside it.
  // Reading the widest of the brief's three half-widths keeps the layout draw and `validateHole`
  // check 2 agreeing about where the walls are.
  const widest = Math.max(...corridor);
  const half = fieldSize / 2 - (widest + BLEND_WIDTH) - EDGE_MARGIN;

  const bearing = random() * Math.PI * 2;
  const dirX = Math.cos(bearing);
  const dirZ = Math.sin(bearing);
  // Distance from the centre to the wall of a square box along +-bearing. The perpendicular
  // bearing swaps |dirX| and |dirZ|, so max() of the pair gives the same reach for both.
  const reach = half / Math.max(Math.abs(dirX), Math.abs(dirZ));

  const band = CORRIDOR_BAND[par];
  const target = band.min + (band.max - band.min) * random();
  const straight = Math.min(reach * 2 * STRAIGHT_FILL, target);

  const tee: Vec2 = { x: (-dirX * straight) / 2, z: (-dirZ * straight) / 2 };
  const cup: Vec2 = { x: (dirX * straight) / 2, z: (dirZ * straight) / 2 };

  // Solve 2 * hypot(straight / 2, apex) = target, then clamp to the box.
  const wanted = Math.sqrt(Math.max(0, (target / 2) ** 2 - (straight / 2) ** 2));
  const offset = Math.min(wanted, reach * APEX_FILL) * (random() < 0.5 ? -1 : 1);
  const apex: Vec2 = { x: -dirZ * offset, z: dirX * offset };

  return {
    seed,
    index,
    fieldSize,
    cells: fieldSize,
    tee,
    cup,
    control: [tee, apex, cup],
    // Placeholder: replaced with the derived value in generateHole, which has the spline.
    par,
    waterLevel: -0.72,
    // Placeholders. `generateHole` resolves the brief's hazards once it has a spline to place
    // them against -- a bunker at "the fairway elbow" has no meaning until the elbow exists.
    water: [],
    bunkers: [],
    green: defaultGreen(cup),
    corridor,
    // Keyed to the hole's position in the course, not to its seed: the routing is a property of
    // the card, so hole 7 is a links hole in every course, whatever its seed draws for layout.
    biome: biomeForIndex(index),
    stripeAngle: stripeAngleFor(seed, index, tee, cup),
  };
}

export interface GenerateOptions {
  /**
   * Overrides the playability validator. Exists so the MAX_ATTEMPTS exhaustion path is
   * testable; production never passes it.
   */
  readonly validate?: (spec: HoleSpec, terrain: Terrain) => HoleRejection | null;
}

/**
 * Rejection sampling: hash (courseSeed, index, attempt) into a seed, draw a layout, build its
 * terrain, and run every check. On rejection, increment `attempt`. On exhausting MAX_ATTEMPTS,
 * throw -- deterministic and bounded, never an unbounded search.
 *
 * `intendedPar` only picks the field size. The par on the returned spec is derived from the
 * corridor the spline actually produced.
 */
export function generateHole(
  courseSeed: number,
  index: number,
  intendedPar: number = parForIndex(index),
  options: GenerateOptions = {},
): HoleSpec {
  const validate = options.validate ?? validateHole;
  let last: HoleRejection = { check: 0, reason: "no attempt was made" };

  const brief = briefForHole((index % 18) + 1);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = draftHole(courseSeed, index, intendedPar, attempt);

    // Hazards are placed against the drafted routing, then the whole thing is validated as one.
    // Placing before validating rather than after is what makes the rejection sampler do useful
    // work: a hole whose water lands somewhere unplayable is a hole to redraw, and validating a
    // hazard-free candidate and *then* adding hazards would ship exactly the holes the checks
    // exist to catch.
    //
    // Channel 1 is the old sand-noise channel, reused for placement -- see `sandChannel`.
    const random = mulberry32(hashChannel(candidate.seed, index, 1));
    const drafted: HoleSpec = {
      ...candidate,
      bunkers: [],
      water: [],
    };
    const spline = createSpline(drafted.control);
    const routing = {
      spline,
      tee: drafted.tee,
      cup: drafted.cup,
      fieldSize: drafted.fieldSize,
      corridor: drafted.corridor,
      green: drafted.green,
      water: [] as readonly Polygon[],
    };
    // Water first, then bunkers *against* that water: both the green and water beat sand in
    // `surfaceAt`, so a bunker placed without knowing where the water went can end up invisible.
    const water = placeWater(brief, routing, random);
    const withHazards: HoleSpec = {
      ...drafted,
      water,
      bunkers: placeBunkers(brief, { ...routing, water }, random),
    };

    const terrain = createTerrain(withHazards);
    // par is the only field the terrain does not depend on, so deriving it after construction
    // costs nothing and keeps "par is never authored" true.
    const spec: HoleSpec = { ...withHazards, par: derivePar(terrain.spline.length) };
    const rejection = validate(spec, terrain);
    if (rejection === null) return spec;
    last = rejection;
  }

  throw new Error(
    `generateHole(${courseSeed}, ${index}) exhausted ${MAX_ATTEMPTS} attempts; ` +
      `the last rejection was check ${last.check}: ${last.reason}`,
  );
}

export function generateCourse(courseSeed: number, holeCount: number): Course {
  const holes: HoleSpec[] = [];
  for (let index = 0; index < holeCount; index++) {
    holes.push(generateHole(courseSeed, index));
  }
  return {
    id: `course-${courseSeed >>> 0}`,
    name: `Course ${(courseSeed >>> 0).toString(16).toUpperCase()}`,
    seed: courseSeed >>> 0,
    holes,
  };
}
