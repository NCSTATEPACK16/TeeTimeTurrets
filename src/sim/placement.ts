/**
 * Brief -> geometry. The step that makes a declarative hazard placement into coordinates.
 *
 * This is the trick the whole authoring system rests on (docs/COURSE_PIPELINE.md §3): a brief says
 * `placement: 'fairway-elbow'` and never a coordinate, so a hole stays reconstructible from a
 * `uint32` and multiplayer ships a seed rather than a level file. The resolution from "the fairway
 * elbow" to a point happens here, against a routing the generator has already drawn and validated.
 *
 * Everything is a pure function of (brief, routing, random). No module state, no clock, no
 * reaching for a global RNG -- the `random` parameter is the AGENTS.md rule about seeded
 * randomness being injected rather than reached for.
 */

import type { HoleBrief } from "./briefs";
import { DRIVER_CARRY_M, REFERENCE_CARRY_M } from "./carry";
import type { Vec2 } from "./course";
import { ellipseEdgeDistance, pointInPolygon, polygonDistance } from "./hazards";
import type { Ellipse, Polygon } from "./hazards";
import { BLEND_WIDTH, WOODS_WEIGHT, halfWidthAt, inverseSmoothstep01 } from "./terrain";
import type { Spline } from "./spline";

/** What placement needs to know about a hole. A subset of `HoleSpec`, before the hazards exist. */
export interface Routing {
  readonly spline: Spline;
  readonly tee: Vec2;
  readonly cup: Vec2;
  readonly fieldSize: number;
  /** Half-widths per control point, from `corridorFor`. */
  readonly corridor: readonly number[];
  /** The putting surface. Greenside bunkers have to clear it or they vanish underneath it. */
  readonly green: Ellipse;
  /**
   * Water already placed on this hole. Bunkers are placed after it and have to keep out of it:
   * both green and water beat sand in `surfaceAt`, so a bunker under either is not a hazard, it
   * is nothing at all.
   */
  readonly water: readonly Polygon[];
}

/**
 * How far past the mown edge a bunker may reach, in metres.
 *
 * Sand belongs to the fairway and the first cut beside it. Beyond `WOODS_WEIGHT` is where
 * `Trees.ts` plants, and a bunker out among the trees is not a hazard anybody plays around -- it
 * is a sand patch in a forest. Deriving the distance from the weight rather than writing a number
 * keeps the two in step: change the blend and the sand line follows the tree line automatically.
 *
 * Works out to ~8.3 m of the 10 m blend band.
 */
const WOODS_OFFSET_M = BLEND_WIDTH * inverseSmoothstep01(WOODS_WEIGHT);

/**
 * Slack between a bunker's rim and the ground it must not touch.
 *
 * The corridor's nearest-distance is measured to a curved spline while a bunker is a straight
 * ellipse, so the two disagree slightly wherever the centreline bends. A metre and a half of
 * margin covers that without moving a bunker anywhere a player would notice.
 */
const HAZARD_MARGIN_M = 1.5;

/** A point on the centreline with its unit tangent and left normal. */
interface Frame {
  readonly x: number;
  readonly z: number;
  readonly tx: number;
  readonly tz: number;
  /** Left of the direction of travel, matching `validateHole`'s convention. */
  readonly nx: number;
  readonly nz: number;
}

function frameAt(spline: Spline, t: number): Frame {
  const p = spline.pointAt(t);
  const tangent = { x: 0, z: 0 };
  spline.tangentInto(t, tangent);
  return { x: p.x, z: p.z, tx: tangent.x, tz: tangent.z, nx: -tangent.z, nz: tangent.x };
}

/**
 * The spline parameter at a given distance along the curve from the tee.
 *
 * `Spline` exposes `length` but no arclength lookup, and t is not proportional to arclength on a
 * Catmull-Rom -- the parameterisation stretches through a tight bend. Walking it is a few hundred
 * cheap samples, happens once per hole at generation time, and is exact enough for "put a bunker
 * where a drive lands".
 */
function tAtDistance(spline: Spline, distance: number): number {
  if (distance <= 0) return 0;
  const steps = 512;
  let travelled = 0;
  let previous = spline.pointAt(0);
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const p = spline.pointAt(t);
    travelled += Math.hypot(p.x - previous.x, p.z - previous.z);
    if (travelled >= distance) return t;
    previous = p;
  }
  return 1;
}

/** Random in [min, max). */
function between(random: () => number, min: number, max: number): number {
  return min + random() * (max - min);
}

/**
 * The brief's three half-widths spread over `count` control points.
 *
 * The ends are pinned to `start` and `end` and everything between takes `mid`, because `mid` is
 * the pinch -- a corridor that narrows through the landing zone and reopens at the green is what
 * makes a drive a decision, and interpolating the middle away would flatten exactly that.
 */
export function corridorFor(brief: HoleBrief, count: number): number[] {
  const { start, mid, end } = brief.corridor;
  if (count <= 1) return [start];
  if (count === 2) return [start, end];
  return [start, ...Array.from({ length: count - 2 }, () => mid), end];
}

/**
 * Which side of the tee-to-cup line the routing bulges toward, as +1 (left) or -1 (right).
 *
 * Needed because "the inside of the turn" is the concave side, which is the *opposite* side from
 * the apex bulge. A bunker on the outside of a dog-leg guards nothing: nobody aims there.
 */
function bulgeSide(routing: Routing): number {
  const { tee, cup, spline } = routing;
  const dx = cup.x - tee.x;
  const dz = cup.z - tee.z;
  const mid = spline.pointAt(0.5);
  // Cross product of the tee->cup vector with tee->midpoint. Positive means the midpoint sits to
  // the left of the straight line.
  const cross = dx * (mid.z - tee.z) - dz * (mid.x - tee.x);
  return cross >= 0 ? 1 : -1;
}

/** Keep a point inside the field with a margin, so a hazard never overhangs the edge. */
function clampToField(value: number, fieldSize: number, margin: number): number {
  const limit = fieldSize / 2 - margin;
  return Math.min(limit, Math.max(-limit, value));
}

/**
 * Bunkers, one per entry in the brief's `placement` list.
 *
 * Every ellipse is aligned to the centreline's tangent where it sits, which is what makes a
 * greenside bunker read as guarding the approach rather than as an arbitrary blob.
 */
export function placeBunkers(
  brief: HoleBrief,
  routing: Routing,
  random: () => number,
): Ellipse[] {
  const out: Ellipse[] = [];
  const bulge = bulgeSide(routing);
  // How many of each kind have been placed already, so two greenside-left bunkers on the same
  // hole (hole 7 has exactly that) spread along the corridor instead of stacking into one blob.
  const seen = new Map<string, number>();
  let firstSide: number | null = null;

  for (const placement of brief.hazards.bunkers.placement) {
    const repeat = seen.get(placement) ?? 0;
    seen.set(placement, repeat + 1);

    let t: number;
    let side: number;

    switch (placement) {
      case "greenside-left":
      case "greenside-right": {
        // Just short of the green, and stepped back a little further for each repeat. Ahead of
        // the cup would be behind the hole, which guards nothing a player has to fly over.
        t = between(random, 0.93, 0.98) - repeat * 0.05;
        side = placement === "greenside-left" ? 1 : -1;
        break;
      }
      case "fairway-elbow": {
        // The inside of the bend, where the aggressive line cuts the corner.
        t = between(random, 0.42, 0.58) + repeat * 0.06;
        side = -bulge;
        break;
      }
      case "landing-zone": {
        // Where a full drive finishes, so it is in play off the tee.
        t = tAtDistance(routing.spline, REFERENCE_CARRY_M + between(random, -12, 12));
        // A pair of landing-zone bunkers pinches the drive from both sides rather than doubling
        // up on one, so the second one takes the opposite bank from the first.
        firstSide = firstSide ?? (random() < 0.5 ? 1 : -1);
        side = repeat % 2 === 0 ? firstSide : -firstSide;
        break;
      }
      case "carry": {
        // Short of the landing zone: a hazard you fly on the way out, not one you land beside.
        t = tAtDistance(routing.spline, DRIVER_CARRY_M * between(random, 0.7, 0.95));
        side = random() < 0.5 ? 1 : -1;
        break;
      }
    }

    const radiusX = between(random, 6, 10);
    const radiusZ = between(random, 3.5, 5.5);
    const baseT = Math.min(0.99, Math.max(0.02, t));
    const lateralBias = between(random, 0, 5);

    /**
     * Where a bunker's centre goes for a given point on the line and a given bank.
     *
     * The bunker has to fit entirely between the centreline and the tree line. `outer` is the
     * furthest its centre may sit; `inner` is the nearest, biting into the fairway edge or
     * sitting just off it, which is where a hazard actually prices a line.
     */
    const centreFor = (at: number, bank: number) => {
      const f = frameAt(routing.spline, at);
      const half = halfWidthAt(routing.corridor, at);
      const outer = half + WOODS_OFFSET_M - radiusZ - HAZARD_MARGIN_M;
      const inner = Math.max(radiusZ + 1, half - lateralBias + radiusZ);
      const offset = Math.min(inner, outer);
      return {
        x: f.x + f.nx * offset * bank,
        z: f.z + f.nz * offset * bank,
        rotation: Math.atan2(f.tz, f.tx),
      };
    };

    /**
     * Sand loses to both the green and water in `surfaceAt`, so a bunker overlapping either shows
     * no sand at all -- hole 7's two greenside bunkers landed inside its inside-elbow water and
     * were invisible. This is what stops that being shipped as "the brief asked for two bunkers
     * and got two bunkers".
     */
    const isClear = (cx: number, cz: number): boolean => {
      if (ellipseEdgeDistance(cx, cz, routing.green) <= radiusZ + HAZARD_MARGIN_M) return false;
      for (const poly of routing.water) {
        if (pointInPolygon(cx, cz, poly)) return false;
        if (polygonDistance(cx, cz, poly) <= radiusZ + HAZARD_MARGIN_M) return false;
      }
      return true;
    };

    // Walk the corridor looking for clear ground, keeping the brief's intent as long as possible:
    // the requested bank first at progressively larger steps along the line, and only then the
    // opposite bank. A greenside-left bunker that can only fit on the right is a compromise, but
    // a bunker nobody can see is not a hazard at all.
    let chosen = centreFor(baseT, side);
    outer: for (const bank of [side, -side]) {
      for (const dt of [0, -0.03, 0.03, -0.06, 0.06, -0.1, 0.1, -0.15, 0.15]) {
        const at = Math.min(0.99, Math.max(0.02, baseT + dt));
        const candidate = centreFor(at, bank);
        if (isClear(candidate.x, candidate.z)) {
          chosen = candidate;
          break outer;
        }
      }
    }

    out.push({
      x: clampToField(chosen.x, routing.fieldSize, radiusX + 2),
      z: clampToField(chosen.z, routing.fieldSize, radiusX + 2),
      radiusX,
      radiusZ,
      rotation: chosen.rotation,
    });
  }

  return out;
}

/** A rectangle in the centreline's local frame, given as world-space corners. */
function bandAt(
  frame: Frame,
  alongHalf: number,
  lateralFrom: number,
  lateralTo: number,
): Polygon {
  const corner = (along: number, lateral: number): Vec2 => ({
    x: frame.x + frame.tx * along + frame.nx * lateral,
    z: frame.z + frame.tz * along + frame.nz * lateral,
  });
  return {
    points: [
      corner(-alongHalf, lateralFrom),
      corner(alongHalf, lateralFrom),
      corner(alongHalf, lateralTo),
      corner(-alongHalf, lateralTo),
    ],
  };
}

function clampPolygon(poly: Polygon, fieldSize: number): Polygon {
  return {
    points: poly.points.map((p) => ({
      x: clampToField(p.x, fieldSize, 0),
      z: clampToField(p.z, fieldSize, 0),
    })),
  };
}

/**
 * Water, one polygon per hazard form.
 *
 * The `crossing` case carries the constraint that matters: `validateHole` check 6 rejects a wet
 * run on the centreline longer than the driver's carry, so a crossing that placement draws too
 * wide would make its own hole unbuildable. The width is drawn from a band that leaves headroom
 * against that limit rather than reaching for it.
 */
export function placeWater(
  brief: HoleBrief,
  routing: Routing,
  random: () => number,
): Polygon[] {
  const hazard = brief.hazards.water;
  if (hazard === null) return [];

  const { spline, fieldSize } = routing;
  const reach = fieldSize / 2;

  switch (hazard.form) {
    case "crossing": {
      // Between a third and a half of the driver's carry: unmistakably a carry, and comfortably
      // inside check 6's ceiling once the diagonal of the crossing is accounted for.
      const width = DRIVER_CARRY_M * between(random, 0.3, 0.5);
      const t = between(random, 0.35, 0.6);
      const frame = frameAt(spline, t);
      return [clampPolygon(bandAt(frame, width / 2, -reach, reach), fieldSize)];
    }

    case "lateral-left":
    case "lateral-right": {
      const side = hazard.form === "lateral-left" ? 1 : -1;
      const t = between(random, 0.45, 0.6);
      const frame = frameAt(spline, t);
      const half = halfWidthAt(routing.corridor, t);
      // Starts outside the mown corridor and its blend band, so it is a lateral hazard rather
      // than a fairway the player is asked to drive through.
      const inner = (half + 12) * side;
      const outer = reach * side;
      return [
        clampPolygon(
          bandAt(frame, between(random, 45, 70), inner, outer),
          fieldSize,
        ),
      ];
    }

    case "inside-elbow": {
      // A lobe filling the inside of the dog-leg -- the corner the cape archetype dares you to
      // cut. Same side as a fairway-elbow bunker would go, and for the same reason.
      const side = -bulgeSide(routing);
      const t = between(random, 0.4, 0.6);
      const frame = frameAt(spline, t);
      const half = halfWidthAt(routing.corridor, t);
      const inner = (half + 8) * side;
      return [
        clampPolygon(bandAt(frame, between(random, 35, 55), inner, reach * side), fieldSize),
      ];
    }

    case "island": {
      // A square of water centred on the green. It is *solid*, not an annulus, because polygons
      // here have no holes -- the green is punched out of it by classification order instead
      // (`surfaces.ts`: green beats water). That ordering exists for exactly this hole.
      const radius = between(random, 26, 34);
      const c = routing.cup;
      const square: Polygon = {
        points: [
          { x: c.x - radius, z: c.z - radius },
          { x: c.x + radius, z: c.z - radius },
          { x: c.x + radius, z: c.z + radius },
          { x: c.x - radius, z: c.z + radius },
        ],
      };
      return [clampPolygon(square, fieldSize)];
    }
  }
}
