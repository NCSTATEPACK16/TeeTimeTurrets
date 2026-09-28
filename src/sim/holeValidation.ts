/**
 * The seven playability checks a hole is held to, and the constants they read.
 *
 * Moved out of `course.ts` so the data model does not carry a validator. The authored course does
 * not pass these checks as a whole (its fields are sized tight to each corridor, so check 2's box
 * rejects them, and its par 5s run past check 7's three driver shots); what it checks is its
 * length band, in `authoredCourse.ts`. These stay because each check is a statement about what
 * makes a hole playable, with its own unit test, and a future hole editor is the natural caller.
 */

import { BLEND_WIDTH, halfWidthAt } from "./terrain";
import type { Terrain } from "./terrain";
import type { MutableVec2 } from "./spline";
import { isWaterAt } from "./hazards";
import { DRIVER_CARRY_M, REFERENCE_CARRY_M } from "./carry";
import type { HoleSpec } from "./course";

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
 * The half-width of the square the centreline must stay inside, measured from the field's centre.
 *
 * The widest half-width the hole authorises, so the box is the one the *whole* corridor has to fit
 * inside rather than the one its narrowest point would allow.
 *
 * `validateHole` check 2 rejects a centreline that leaves this box.
 */
export function corridorBox(fieldSize: number, corridor: readonly number[]): number {
  return fieldSize / 2 - (Math.max(...corridor) + BLEND_WIDTH) - EDGE_MARGIN;
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
