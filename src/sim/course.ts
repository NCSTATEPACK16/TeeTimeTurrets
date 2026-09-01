/**
 * The course data model. Plain data: DOM-free, no Rapier, no Three, no imports at all yet.
 *
 * A course is nine holes, not one nine-hole map. Each HoleSpec owns its own field, terrain and
 * surfaces, and playing a round loads one at a time -- which is what makes "multiple courses,
 * one selected at a time" fall out of the data model instead of needing streaming, chunking, or
 * a level format. A second course is a second list.
 */

import { BLEND_WIDTH, GREEN_RADIUS, HALF_WIDTH, createTerrain } from "./terrain";
import type { Terrain } from "./terrain";
import type { MutableVec2 } from "./spline";
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

/** A 20 m par 3 is not a hole. */
export const MIN_HOLE_LENGTH = 60;

/** Clearance between the corridor's outer edge and the field boundary. */
export const EDGE_MARGIN = 6;

/**
 * The driver's full-power distance, in metres, as measured by `npm run probe` in Phase 0:
 * 129 m TOTAL -- 69.5 m carry plus 59.5 m roll-out. Total rather than carry is the right
 * quantity for both consumers: a hole is reachable on where the ball ends up, and par follows
 * the same logic.
 *
 * This is NOT a second copy of CLUB_STATS. AGENTS.md forbids a second source of truth for club
 * stats, and distance is not a field in that table -- it is an emergent result of the
 * ballistics integration. The link is closed by a probe assertion that measured driver distance
 * stays within +-15% of this number, so a club-balance change that invalidates par fails the
 * probe instead of silently mis-parring every hole.
 */
export const REFERENCE_CARRY_M = 129;

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

  const room = spec.fieldSize / 2 - (HALF_WIDTH + BLEND_WIDTH) - EDGE_MARGIN;
  const arm = HALF_WIDTH + BLEND_WIDTH / 2;
  const steps = Math.max(2, Math.ceil(spline.length / CENTRELINE_SAMPLE_M));
  const tangent: MutableVec2 = { x: 0, z: 0 };
  let previousX = 0;
  let previousZ = 0;
  let previousHeight = 0;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = spline.pointAt(t);
    const height = terrain.heightAt(p.x, p.z);

    if (Math.abs(p.x) > room || Math.abs(p.z) > room) {
      return {
        check: 2,
        reason: `centreline reaches (${p.x.toFixed(1)}, ${p.z.toFixed(1)}), outside the ${room.toFixed(1)} m box`,
      };
    }

    if (height < spec.waterLevel) {
      return {
        check: 6,
        reason: `centreline height ${height.toFixed(2)} m is below the water level ${spec.waterLevel}`,
      };
    }

    if (i > 0) {
      const run = Math.hypot(p.x - previousX, p.z - previousZ);
      if (run > 1e-6) {
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

    // Each side is measured against the centreline separately rather than across the full
    // width: averaging the two banks lets an asymmetric bowl cancel itself out and pass.
    spline.tangentInto(t, tangent);
    const normalX = -tangent.z;
    const normalZ = tangent.x;
    for (const side of [-1, 1]) {
      const camber =
        Math.abs(
          terrain.heightAt(p.x + normalX * arm * side, p.z + normalZ * arm * side) - height,
        ) / arm;
      if (camber > MAX_CAMBER_GRAD) {
        return {
          check: 4,
          reason: `lateral camber ${camber.toFixed(4)} at t=${t.toFixed(3)} exceeds ${MAX_CAMBER_GRAD.toFixed(4)}`,
        };
      }
    }
  }

  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 24) {
    for (let radius = 1; radius <= GREEN_RADIUS; radius += 1) {
      const x = spec.cup.x + Math.cos(angle) * radius;
      const z = spec.cup.z + Math.sin(angle) * radius;
      const dx = (terrain.heightAt(x + 0.5, z) - terrain.heightAt(x - 0.5, z)) / 1.0;
      const dz = (terrain.heightAt(x, z + 0.5) - terrain.heightAt(x, z - 0.5)) / 1.0;
      const grade = Math.hypot(dx, dz);
      if (grade > MAX_GREEN_GRAD) {
        return {
          check: 5,
          reason: `green grade ${grade.toFixed(4)} at ${radius} m from the cup exceeds ${MAX_GREEN_GRAD.toFixed(4)}`,
        };
      }
    }
  }

  return null;
}

/**
 * A par-36 front nine. Cycled for courses that are not nine holes, so an 18-hole course is two
 * nines rather than an error.
 */
const PAR_MIX: readonly number[] = [4, 3, 4, 5, 4, 3, 4, 4, 5];

export function parForIndex(index: number): number {
  return PAR_MIX[((index % PAR_MIX.length) + PAR_MIX.length) % PAR_MIX.length];
}

/**
 * Field size scales with the par being aimed at, which is why fieldSize lives on HoleSpec
 * rather than being global. `cells` tracks it to hold the cell near 1.0 m: a coarser cell makes
 * heightfield triangle seams large enough for the 0.15 m ball to trip over.
 */
const FIELD_FOR_PAR: Readonly<Record<number, number>> = { 3: 160, 4: 220, 5: 300 };

/** Corridor length bands, chosen so derivePar returns the par the field was sized for. */
const CORRIDOR_BAND: Readonly<Record<number, { min: number; max: number }>> = {
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

  const fieldSize = FIELD_FOR_PAR[par];
  const half = fieldSize / 2 - (HALF_WIDTH + BLEND_WIDTH) - EDGE_MARGIN;

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

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = draftHole(courseSeed, index, intendedPar, attempt);
    const terrain = createTerrain(candidate);
    // par is the only field the terrain does not depend on, so deriving it after construction
    // costs nothing and keeps "par is never authored" true.
    const spec: HoleSpec = { ...candidate, par: derivePar(terrain.spline.length) };
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
