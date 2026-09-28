import { toCourseFrame } from "./courseGeometry";
import type { CourseFrame } from "./courseGeometry";
import type { Vec2 } from "./mapGeometry";
import type { MutableSurfaceTuning } from "./surfaces";
import { ARENA_HOLE_INDICES } from "./arenaZone";

/**
 * Cart paths: the fast way round the course.
 *
 * Straight runs from the clubhouse to each arena hole's tee, and from every green to the next
 * hole's tee, as a course routes its carts. Driving on one lifts the cart's speed above anything
 * turf gives (`PATH_SPEED_SCALE`), which is what makes a path a route worth taking in a fight
 * rather than decoration.
 *
 * DOM-free and deterministic: the paths are a pure function of the placed holes and the clubhouse,
 * and `pathWeightAt` is arithmetic on a few dozen segments, allocation-free for the tick.
 */

export const PATH_HALF_WIDTH_M = 1.6;
/** Metres over which the path's edge blends into the turf beside it. */
export const PATH_EDGE_M = 1;
/** The speed multiplier on a path: above fairway's 1.0, so the path is the quick line. */
export const PATH_SPEED_SCALE = 1.12;

export interface CartPath {
  readonly kind: "clubhouse" | "green-to-tee";
  /** Course frame, first to last. */
  readonly points: readonly Vec2[];
}

/** The slice of a placed hole the paths are built from; `PlacedHole` satisfies it. */
export interface PathHole {
  readonly placement: CourseFrame;
  readonly spec: { readonly index: number; readonly tee: Vec2; readonly cup: Vec2 };
}

export function createCartPaths(holes: readonly PathHole[], clubhouse: Vec2 | null): CartPath[] {
  const byIndex = [...holes].sort((a, b) => a.spec.index - b.spec.index);
  const course = (hole: PathHole, p: Vec2): Vec2 => {
    const out = { x: 0, z: 0 };
    toCourseFrame(hole.placement, p.x, p.z, out);
    return out;
  };
  const paths: CartPath[] = [];
  if (clubhouse !== null) {
    for (const hole of byIndex) {
      if (!(ARENA_HOLE_INDICES as readonly number[]).includes(hole.spec.index)) continue;
      paths.push({ kind: "clubhouse", points: [{ x: clubhouse.x, z: clubhouse.z }, course(hole, hole.spec.tee)] });
    }
  }
  for (let i = 0; i + 1 < byIndex.length; i++) {
    const from = byIndex[i]!;
    const to = byIndex[i + 1]!;
    paths.push({ kind: "green-to-tee", points: [course(from, from.spec.cup), course(to, to.spec.tee)] });
  }
  return paths;
}

/** 1 on a path, 0 off every path, blended across its edge. */
export function pathWeightAt(paths: readonly CartPath[], x: number, z: number): number {
  let best = Infinity;
  for (const path of paths) {
    const pts = path.points;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const len2 = ex * ex + ez * ez;
      const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - a.x) * ex + (z - a.z) * ez) / len2)) : 0;
      const dx = x - (a.x + ex * t);
      const dz = z - (a.z + ez * t);
      const d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
  }
  const over = Math.sqrt(best) - PATH_HALF_WIDTH_M;
  if (over <= 0) return 1;
  if (over >= PATH_EDGE_M) return 0;
  const s = 1 - over / PATH_EDGE_M;
  return s * s * (3 - 2 * s);
}

/** Lifts a cart's speed toward `PATH_SPEED_SCALE` by the path's weight. Water stays water. */
export function applyPathBonus(tuning: MutableSurfaceTuning, weight: number): void {
  if (weight <= 0 || tuning.isHazard) return;
  tuning.cartSpeedScale += (PATH_SPEED_SCALE - tuning.cartSpeedScale) * weight;
}
