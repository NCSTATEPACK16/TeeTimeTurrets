import type { HoleSpec } from "./course";
import { isWaterAt } from "./hazards";
import { createSpline } from "./spline";
import { smoothstep01 } from "./curves";

/**
 * Where the hole's centreline crosses water, and therefore where a causeway goes.
 *
 * **Derived after a hole validates, and not reachable from `validateHole`** (spec D9). That is the
 * point of the whole module rather than a note about it: routing stays bit-for-bit identical, par,
 * corridor, field size and the acceptance rate do not move, and the eighteen holes keep the shape
 * they have. Holes 2, 13 and 15 gain an alternative to their forced carries rather than being
 * re-judged. Relaxing the wet-run check so a bridged carry counts as playable would regenerate the
 * whole course; that is a separate decision on its own merits.
 *
 * **A causeway, not a bridge, and that is arithmetic rather than taste** (spec §2.2). The
 * heightfield cell is exactly `fieldSize / cells` = 1.0 m and cannot be refined locally; the cart's
 * character controller autosteps 0.45 m and climbs to 45°. So a deck less than 0.45 m proud has no
 * edge at all -- the cart simply steps onto it; a deck 0.8 m proud has 39° shoulders it drives up
 * and down at will; a deck 1.0 m proud or more has shoulders it cannot climb, which is an invisible
 * wall and the same seam the 1 m-cell comment warns the 0.15 m ball trips over. There is no width or
 * height at which a heightfield deck behaves like a narrow bridge with a real edge. So this is a
 * low plank causeway with railings -- the sheet's **boardwalk**, at the scale 1 m cells can hold --
 * and leaving the deck is a choice you make down a shoulder rather than a fall you suffer.
 *
 * Pure, DOM-free, three-free, and takes no seed.
 */

/** Half the flat deck, metres. 6 m of deck: two carts wide, and expressible in 1 m cells. */
export const DECK_HALF_WIDTH = 3;

/**
 * How far the shoulder runs out from the deck edge before the ground is the pond floor again.
 *
 * Long and gentle on purpose (spec §7): the shoulder/pond junction is the most likely place on the
 * whole causeway for the cart to catch or the ball to trip, and a shorter tidier ramp buys nothing
 * but a steeper seam.
 *
 * **Sized against the ramp's steepest point, not its average, and the difference is the whole
 * reason this number is 6 and not 4.** The drop is `DECK_FREEBOARD` above the water plus
 * `WATER_DEPTH` below it: 1.95 m. Smoothstep's derivative peaks at 1.5x its mean, so the steepest
 * grade on the shoulder is `1.5 * 1.95 / run` rather than `1.95 / run`. At a 4 m run that is 36°,
 * over the controller's 32° slide angle -- a cart that stops on the ramp slides off it. At 6 m it
 * is 26°, under the slide angle so a cart holds, and far under the 45° climb limit so it can drive
 * back up. `terrain.test.ts` measures the real height field rather than trusting this comment.
 */
export const DECK_SHOULDER_RUN = 6;

/** Metres of deck above the rendered water plane. Low: this is a plank causeway, not a viaduct. */
export const DECK_FREEBOARD = 0.45;

/** Metres of dry bank the deck runs onto at each end, so it lands rather than stopping at the water. */
const DECK_ABUTMENT_M = 4;

/** Centreline sampling pitch when hunting for the wet run. Finer than the 1 m heightfield cell. */
const SAMPLE_M = 0.5;

/**
 * One deck: a straight segment along the centreline from `a` to `b`, both ends on dry land.
 *
 * Straight rather than following the spline's curve because a causeway is a built thing. A pond
 * long enough that the centreline curves appreciably across it would want two segments, and
 * `deriveCrossings` would return two.
 */
export interface Crossing {
  readonly ax: number;
  readonly az: number;
  readonly bx: number;
  readonly bz: number;
}

/**
 * The causeway segments for a hole, one per stretch of water its centreline crosses.
 *
 * Empty on a dry hole, which is ten of the eighteen briefs and therefore the common path.
 */
export function deriveCrossings(spec: HoleSpec): Crossing[] {
  if (spec.water.length === 0) return [];

  const spline = createSpline(spec.control);
  const steps = Math.max(2, Math.ceil(spline.length / SAMPLE_M));
  const out: Crossing[] = [];

  let entry: number | null = null;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const point = spline.pointAt(t);
    const wet = isWaterAt(spec, point.x, point.z);

    if (wet && entry === null) entry = t;
    if (!wet && entry !== null) {
      out.push(deck(spline, entry, (i - 1) / steps));
      entry = null;
    }
  }
  // A centreline that ends in water: the cup itself is wet, which `validateHole` already rejects.
  // Closed off anyway rather than dropped, so this function is total on any spec it is handed.
  if (entry !== null) out.push(deck(spline, entry, 1));

  return out;
}

/**
 * How much the causeway owns this point: 1 on the deck, ramping to 0 across the shoulder, 0 beyond.
 *
 * Smoothstepped rather than linear so the shoulder has no slope discontinuity at either end of the
 * ramp -- the same reason `terrain.ts` smoothsteps its shoreline, and the same failure if it did
 * not: a crease the ball catches on at 1 m cells.
 */
export function causewayInfluence(crossings: readonly Crossing[], x: number, z: number): number {
  let best = 0;
  for (const crossing of crossings) {
    const distance = distanceToDeck(crossing, x, z);
    if (distance <= DECK_HALF_WIDTH) return 1;
    if (distance >= DECK_HALF_WIDTH + DECK_SHOULDER_RUN) continue;
    const t = (distance - DECK_HALF_WIDTH) / DECK_SHOULDER_RUN;
    best = Math.max(best, 1 - smoothstep01(t));
  }
  return best;
}

/** True where the causeway carries the ground, deck and shoulders alike. `SurfaceId.Bridge`'s
 *  footprint: the shoulders are part of the crossing, and a cart on one must not take a water
 *  stroke for standing on ground the causeway raised above the pond. */
export function isOnCauseway(crossings: readonly Crossing[], x: number, z: number): boolean {
  return causewayInfluence(crossings, x, z) > 0;
}

/** Perpendicular distance to the deck segment, capped at its ends so it does not run on forever. */
function distanceToDeck(crossing: Crossing, x: number, z: number): number {
  const dx = crossing.bx - crossing.ax;
  const dz = crossing.bz - crossing.az;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq < 1e-9) return Math.hypot(x - crossing.ax, z - crossing.az);
  const t = Math.min(1, Math.max(0, ((x - crossing.ax) * dx + (z - crossing.az) * dz) / lengthSq));
  return Math.hypot(x - (crossing.ax + dx * t), z - (crossing.az + dz * t));
}

/** A deck spanning the wet run between two spline parameters, extended onto dry bank at both ends. */
function deck(spline: ReturnType<typeof createSpline>, tIn: number, tOut: number): Crossing {
  const a = spline.pointAt(tIn);
  const b = spline.pointAt(tOut);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz) || 1;
  const ux = dx / length;
  const uz = dz / length;
  return {
    ax: a.x - ux * DECK_ABUTMENT_M,
    az: a.z - uz * DECK_ABUTMENT_M,
    bx: b.x + ux * DECK_ABUTMENT_M,
    bz: b.z + uz * DECK_ABUTMENT_M,
  };
}
