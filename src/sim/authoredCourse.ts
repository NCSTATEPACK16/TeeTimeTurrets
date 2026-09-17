/**
 * The eighteen holes, authored from a real routing instead of drafted by a solver.
 *
 * **Why this module exists.** `generateCourse` drafts holes by sampling `DRAFT_BAND` and placing
 * them by physics relaxation. It works, it is deterministic, and the result does not read as a
 * golf course -- because it is about two-thirds real length hole for hole. Measured against a real
 * par-72 card: not one of its eighteen holes was legal under the old bands, and the old par-4
 * *minimum* (148 yd) was shorter than every real par 3. A course made of holes that are all a
 * third too short reads as a miniature of a golf course rather than as one.
 *
 * **What is authored and what is not.** Par, White-tee yardage, and the centreline's shape are
 * data. Everything below them stays seeded from `HoleSpec.seed` exactly as before -- terrain noise,
 * green shaping, bunker placement, water placement, tree scatter and the course rough. The course
 * stops being *discovered* by a solver and starts being *described*, which is what a routed golf
 * course is; it does not stop being reproducible from a number.
 *
 * **Lengths are authored in yards and simulated in metres.** One exact conversion at the boundary
 * (`./units`), and no physics constant moves. See that module for why the simulation stays metric.
 *
 * **Where the control points came from, and the honest limit on them.** The source plat has no
 * scale bar, and its drawn fairway shapes disagree with the scorecard by up to a fifth -- so hole
 * *lengths* are the card's, not the drawing's, and only the *bend* of each hole was read off the
 * map. The coordinates below were fitted once: take the bend as a fraction of hole length, then
 * scale until the spline's arc length is the card's yardage. That fitting is authoring, not
 * runtime -- its output is the literals below, which is what keeps
 * `authoredCourse.test.ts`'s arc-length assertion meaningful against any later hand-edit.
 *
 * **Positions and bearings are not here.** These control points are in each hole's own local
 * frame, running along +x with the dog-leg apex offset in z. Where each hole sits in the course
 * and which way it points is `authoredLayout.ts`'s business.
 *
 * Provenance for the routing is recorded in `LICENSES.md`.
 */

import { CORRIDOR_BAND, fieldSizeFor, biomeForIndex, defaultGreen, stripeAngleFor } from "./course";
import type { Course, HoleSpec, Vec2 } from "./course";
import { briefForHole } from "./briefs";
import { corridorFor, placeBunkers, placeWater } from "./placement";
import { createSpline } from "./spline";
import { hashChannel, mulberry32 } from "./rng";
import { toMetres } from "./units";
import type { Polygon } from "./hazards";

export interface AuthoredHole {
  readonly index: number;
  readonly par: number;
  /** From the White tees, as the scorecard prints it. Converted at construction, never stored in metres. */
  readonly whiteYards: number;
  readonly tee: Vec2;
  readonly cup: Vec2;
  /** Tee first, cup last. The interior point is the dog-leg apex traced off the plat. */
  readonly control: readonly Vec2[];
}

/**
 * Par 72, 6,215 yards from the White tees. Front 3,219 / par 36, back 2,996 / par 36.
 *
 * The `z` on each middle control point is the dog-leg: positive is left of the line of play,
 * negative is right, and zero is a hole the plat draws straight. Its magnitude is the fitted
 * apex offset, not a round number, because the fit is what makes each spline's arc length equal
 * its card yardage to within a hundredth of a yard.
 */
export const AUTHORED_HOLES: readonly AuthoredHole[] = [
  { index: 0, par: 5, whiteYards: 508, tee: { x: -230.393, z: 0 }, cup: { x: 230.393, z: 0 }, control: [{ x: -230.393, z: 0 }, { x: 0, z: 27.647 }, { x: 230.393, z: 0 }] },
  { index: 1, par: 4, whiteYards: 381, tee: { x: -173.84, z: 0 }, cup: { x: 173.84, z: 0 }, control: [{ x: -173.84, z: 0 }, { x: 0, z: -10.43 }, { x: 173.84, z: 0 }] },
  { index: 2, par: 4, whiteYards: 381, tee: { x: -174.193, z: 0 }, cup: { x: 174.193, z: 0 }, control: [{ x: -174.193, z: 0 }, { x: 0, z: 0 }, { x: 174.193, z: 0 }] },
  { index: 3, par: 3, whiteYards: 180, tee: { x: -82.296, z: 0 }, cup: { x: 82.296, z: 0 }, control: [{ x: -82.296, z: 0 }, { x: 0, z: 0 }, { x: 82.296, z: 0 }] },
  { index: 4, par: 4, whiteYards: 342, tee: { x: -155.487, z: 0 }, cup: { x: 155.487, z: 0 }, control: [{ x: -155.487, z: 0 }, { x: 0, z: -15.549 }, { x: 155.487, z: 0 }] },
  { index: 5, par: 3, whiteYards: 171, tee: { x: -78.181, z: 0 }, cup: { x: 78.181, z: 0 }, control: [{ x: -78.181, z: 0 }, { x: 0, z: 0 }, { x: 78.181, z: 0 }] },
  { index: 6, par: 4, whiteYards: 393, tee: { x: -179.034, z: 0 }, cup: { x: 179.034, z: 0 }, control: [{ x: -179.034, z: 0 }, { x: 0, z: 14.323 }, { x: 179.034, z: 0 }] },
  { index: 7, par: 5, whiteYards: 458, tee: { x: -207.121, z: 0 }, cup: { x: 207.121, z: 0 }, control: [{ x: -207.121, z: 0 }, { x: 0, z: -28.997 }, { x: 207.121, z: 0 }] },
  { index: 8, par: 4, whiteYards: 405, tee: { x: -183.68, z: 0 }, cup: { x: 183.68, z: 0 }, control: [{ x: -183.68, z: 0 }, { x: 0, z: 22.042 }, { x: 183.68, z: 0 }] },
  { index: 9, par: 3, whiteYards: 178, tee: { x: -81.382, z: 0 }, cup: { x: 81.382, z: 0 }, control: [{ x: -81.382, z: 0 }, { x: 0, z: 0 }, { x: 81.382, z: 0 }] },
  { index: 10, par: 4, whiteYards: 320, tee: { x: -145.778, z: 0 }, cup: { x: 145.778, z: 0 }, control: [{ x: -145.778, z: 0 }, { x: 0, z: -11.662 }, { x: 145.778, z: 0 }] },
  { index: 11, par: 4, whiteYards: 368, tee: { x: -165.26, z: 0 }, cup: { x: 165.26, z: 0 }, control: [{ x: -165.26, z: 0 }, { x: 0, z: -29.747 }, { x: 165.26, z: 0 }] },
  { index: 12, par: 4, whiteYards: 322, tee: { x: -144.011, z: 0 }, cup: { x: 144.011, z: 0 }, control: [{ x: -144.011, z: 0 }, { x: 0, z: 28.802 }, { x: 144.011, z: 0 }] },
  { index: 13, par: 5, whiteYards: 450, tee: { x: -203.503, z: 0 }, cup: { x: 203.503, z: 0 }, control: [{ x: -203.503, z: 0 }, { x: 0, z: 28.49 }, { x: 203.503, z: 0 }] },
  { index: 14, par: 4, whiteYards: 380, tee: { x: -172.764, z: 0 }, cup: { x: 172.764, z: 0 }, control: [{ x: -172.764, z: 0 }, { x: 0, z: -17.276 }, { x: 172.764, z: 0 }] },
  { index: 15, par: 4, whiteYards: 371, tee: { x: -165.926, z: 0 }, cup: { x: 165.926, z: 0 }, control: [{ x: -165.926, z: 0 }, { x: 0, z: -33.185 }, { x: 165.926, z: 0 }] },
  { index: 16, par: 3, whiteYards: 147, tee: { x: -67.208, z: 0 }, cup: { x: 67.208, z: 0 }, control: [{ x: -67.208, z: 0 }, { x: 0, z: 0 }, { x: 67.208, z: 0 }] },
  { index: 17, par: 5, whiteYards: 460, tee: { x: -208.624, z: 0 }, cup: { x: 208.624, z: 0 }, control: [{ x: -208.624, z: 0 }, { x: 0, z: -25.035 }, { x: 208.624, z: 0 }] },
];

/**
 * One authored hole, with its hazards and green placed from the seed exactly as `generateHole`
 * places a drafted one.
 *
 * No rejection sampling, and that is the point of authoring: a drafted hole that fails a check is
 * redrawn, but an authored hole that fails one is a hole somebody chose and the answer is to fix
 * the data, not to roll again. What survives of validation is the band check below.
 */
function authoredHoleSpec(courseSeed: number, authored: AuthoredHole): HoleSpec {
  const { index, par, control, tee, cup } = authored;
  const spline = createSpline(control);

  // The card is checked against the band rather than the band choosing the card: an authored `58`
  // where `580` was meant has to fail loudly here rather than ship as a hole a third of its length.
  // A bound with no consumer is a comment, not a check.
  const band = CORRIDOR_BAND[par];
  if (band === undefined) {
    throw new Error(`hole ${index + 1}: par ${par} has no corridor band`);
  }
  if (spline.length < band.min || spline.length > band.max) {
    throw new Error(
      `hole ${index + 1}: authored corridor is ${spline.length.toFixed(1)} m, outside the par-${par} band ${band.min}-${band.max} m (card says ${authored.whiteYards} yd = ${toMetres(authored.whiteYards).toFixed(1)} m)`,
    );
  }

  const seed = hashChannel(courseSeed, index, 0);
  const brief = briefForHole((index % 18) + 1);
  const corridor = corridorFor(brief, control.length);
  const fieldSize = fieldSizeFor(control, corridor);

  const base: HoleSpec = {
    seed,
    index,
    fieldSize,
    cells: fieldSize,
    tee,
    cup,
    control,
    par,
    waterLevel: -0.72,
    water: [],
    bunkers: [],
    green: defaultGreen(cup),
    corridor,
    biome: biomeForIndex(index),
    stripeAngle: stripeAngleFor(seed, index, tee, cup),
  };

  // Channel 1 is the placement channel, the same one `generateHole` draws from, so an authored
  // hole's hazards come off the seed exactly as a drafted hole's do.
  const random = mulberry32(hashChannel(seed, index, 1));
  const routing = {
    spline,
    tee,
    cup,
    fieldSize,
    corridor,
    green: base.green,
    water: [] as readonly Polygon[],
  };
  // Water first, then bunkers *against* that water: both the green and water beat sand in
  // `surfaceAt`, so a bunker placed without knowing where the water went can end up invisible.
  const water = placeWater(brief, routing, random);
  return { ...base, water, bunkers: placeBunkers(brief, { ...routing, water }, random) };
}

/**
 * `seed` drives everything below the routing and nothing in it. Same seed, same course; a
 * different seed keeps all eighteen centrelines and re-rolls the detail under them.
 */
export function authoredCourse(seed: number): Course {
  return {
    id: `authored-${seed >>> 0}`,
    name: `Caswell Pines ${(seed >>> 0).toString(16).toUpperCase()}`,
    seed: seed >>> 0,
    holes: AUTHORED_HOLES.map((authored) => authoredHoleSpec(seed, authored)),
  };
}
