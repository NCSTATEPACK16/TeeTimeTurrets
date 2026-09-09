import * as THREE from "three";
import { mergeGraph } from "../entities/primitiveGraph";
import { graphFor } from "../entities/propGraphs";
import type { PropName } from "../entities/propGraphs";
import type { HoleSpec, Vec2 } from "../sim/course";
import type { Ellipse, Polygon } from "../sim/hazards";
import { createSpline } from "../sim/spline";
import { createSurfaceWeights } from "../sim/surfaces";
import type { Surfaces } from "../sim/surfaces";
import type { Terrain } from "../sim/terrain";

/**
 * The course props, placed.
 *
 * **Derived from the hole, not seeded and not authored** (spec D8). Every position below is a pure
 * function of `HoleSpec`: markers flank `spec.tee`, a rake stands at each `spec.bunkers` rim, posts
 * are set by their yardage back from the cup along `spec.control`. That is not tidiness — a seeded
 * scatter would put bunker rakes forty metres from any bunker, which is worse than no rake.
 *
 * It follows that this file **adds nothing to the seed and needs no RNG channel** (trees already own
 * channel 3, `COURSE_PIPELINE.md:285`) and that it **cannot alter a trajectory**: it lives entirely
 * in `src/render/**`, owns no collider, and the sim never sees it. `props.test.ts` holds the seed
 * half by rebuilding a hole with only its seed changed and asserting the placements are identical.
 *
 * Each prop is one merged draw call (`mergeGraph`), which is the whole of §2.3's arithmetic: about
 * a dozen instances on a hole is ~60 draws built node-by-node and ~12 merged.
 */

/**
 * Hard ceiling on props per hole, and the number spec criterion 11 is asserted against. Draw calls
 * are what the budget cares about (`ASSET_PIPELINE.md` §9), and a hole with a dozen bunkers must not
 * turn into a dozen rakes.
 *
 * **Nothing today can reach it**, and that is worth saying rather than implying otherwise: with
 * `MAX_RAKES` capping the only prop whose count follows the hole, the derivation below tops out at
 * twelve -- two markers, two pieces of tee furniture, four rakes, three posts and a bridge, which is
 * exactly §2.3's prediction. The ceiling is here for the next prop kind that is added, not for
 * these; the cap that is actually load-bearing is `MAX_RAKES`.
 */
export const MAX_PROPS_PER_HOLE = 20;

/** Metres either side of the tee. Wide enough to drive between, which is what a tee box is. */
const TEE_MARKER_SPREAD = 2.4;
/** The washer and the sign stand behind the tee, clear of the swing and of the cart's spawn. */
const TEE_FURNITURE_BACK = 4.5;
const TEE_FURNITURE_SIDE = 3.0;

/**
 * Yardage markers, in metres back from the cup along the centreline: the 150, 100 and 50 yard posts
 * a real course carries. A hole shorter than one of them simply does not get it.
 */
const MARKER_DISTANCES_M = [137, 91, 46] as const;
/** Below this much hole left, a post would be standing on the green. */
const MARKER_MIN_CLEARANCE_M = 18;

/** Rakes are capped well under the budget: they are the only prop whose count follows the hole. */
export const MAX_RAKES = 4;
/** How far outside a bunker's rim a rake is propped. Inside it would be sitting in the sand. */
const RAKE_RIM_OFFSET_M = 0.6;

/** A pond must clear the corridor by this much before D6 will bridge it. */
const BRIDGE_CORRIDOR_CLEARANCE_M = 6;
/** And be at least this wide, or the bridge is longer than the water it spans. */
const BRIDGE_MIN_SPAN_M = 6;

export interface PropPlacement {
  readonly prop: PropName;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Radians about +Y, in Three's convention. */
  readonly yaw: number;
}

export interface Props {
  readonly objects: readonly THREE.Object3D[];
  dispose(): void;
}

/**
 * Where every prop on this hole goes. Pure, exported separately from the geometry so the derivation
 * can be asserted without building a single mesh -- and so a gate subject can build a prop's shape
 * with no terrain, which `tools/gate/gateScene.ts` requires.
 */
export function derivePlacements(terrain: Terrain, surfaces: Surfaces): PropPlacement[] {
  const spec = terrain.spec;
  const out: PropPlacement[] = [];
  const weights = createSurfaceWeights();

  /** Sits a prop on the terrain, and refuses sand and water the way `Trees.ts` does. */
  const put = (prop: PropName, x: number, z: number, yaw: number): void => {
    if (out.length >= MAX_PROPS_PER_HOLE) return;
    surfaces.weightsAt(x, z, weights);
    if (weights.sand === 1 || weights.water === 1) return;
    out.push({ prop, x, y: terrain.heightAt(x, z), z, yaw });
  };

  const teeHeading = headingFrom(spec.tee, spec.control[1] ?? spec.cup);

  // Tee markers, one either side of the tee, square to the hole -- the pair a player tees between.
  for (const side of [1, -1]) {
    put(
      "tee_marker",
      spec.tee.x - Math.sin(teeHeading) * TEE_MARKER_SPREAD * side,
      spec.tee.z + Math.cos(teeHeading) * TEE_MARKER_SPREAD * side,
      teeHeading,
    );
  }

  // Tee furniture: behind the tee and to opposite sides, so neither is in the line of a swing.
  for (const [prop, side] of [["ball_washer", 1], ["cart_path_sign", -1]] as const) {
    put(
      prop,
      spec.tee.x - Math.cos(teeHeading) * TEE_FURNITURE_BACK - Math.sin(teeHeading) * TEE_FURNITURE_SIDE * side,
      spec.tee.z - Math.sin(teeHeading) * TEE_FURNITURE_BACK + Math.cos(teeHeading) * TEE_FURNITURE_SIDE * side,
      teeHeading + Math.PI,
    );
  }

  const spline = createSpline(spec.control);

  // A rake at each bunker's rim.
  for (const bunker of spec.bunkers.slice(0, MAX_RAKES)) {
    // Away from the centreline: a rake between the bunker and the fairway stands in the line of
    // the shot out of it.
    const away = headingFrom(spline.pointAt(spline.nearest(bunker.x, bunker.z).t), bunker);
    const rim = rimPoint(bunker, away, RAKE_RIM_OFFSET_M);
    put("bunker_rake", rim.x, rim.z, away);
  }

  // Yardage posts, set by arc length back from the cup so a dog-leg's markers follow the hole
  // rather than the straight line to the green.
  for (const distance of MARKER_DISTANCES_M) {
    if (spline.length - distance < MARKER_MIN_CLEARANCE_M) continue;
    const t = 1 - distance / spline.length;
    const centre = spline.pointAt(t);
    const ahead = spline.pointAt(Math.min(1, t + 0.02));
    const heading = headingFrom(centre, ahead);
    // Offset to the corridor's edge rather than left standing in the fairway: the post carries no
    // collider, so a cart would drive straight through one on the driving line.
    const offset = halfWidthAt(spec.corridor, t) - 1.5;
    put(
      "distance_post",
      centre.x - Math.sin(heading) * offset,
      centre.z + Math.cos(heading) * offset,
      heading + Math.PI,
    );
  }

  const bridge = bridgeSite(spec, spline);
  if (bridge !== null) {
    // The one prop allowed on water, and the reason `put`'s hazard rejection is bypassed here: a
    // footbridge that refused to stand on a pond would be a footbridge on dry land (spec D6).
    if (out.length < MAX_PROPS_PER_HOLE) {
      out.push({
        prop: "footbridge",
        x: bridge.x,
        y: terrain.heightAt(bridge.x, bridge.z),
        z: bridge.z,
        yaw: bridge.yaw,
      });
    }
  }

  return out;
}

/**
 * Builds the placed props. Matches `createGround`/`createTrees`' shape so `scene.ts` and
 * `backdrop.ts` wire it identically -- and `backdrop.ts` is the one that gets forgotten.
 */
export function createProps(terrain: Terrain, surfaces: Surfaces): Props {
  const placements = derivePlacements(terrain, surfaces);
  const built = placements.map((placement) => {
    const merged = mergeGraph(graphFor(placement.prop));
    merged.mesh.position.set(placement.x, placement.y, placement.z);
    merged.mesh.rotation.y = placement.yaw;
    return merged;
  });

  return {
    objects: built.map((m) => m.mesh),
    dispose: () => {
      for (const merged of built) merged.dispose();
    },
  };
}

/** Three's yaw about +Y for a heading from `from` to `to` in world XZ. */
function headingFrom(from: Vec2 | { x: number; z: number }, to: Vec2 | { x: number; z: number }): number {
  return Math.atan2(to.z - from.z, to.x - from.x);
}

/** A point `outside` metres beyond an ellipse's rim, along the ray leaving its centre at `angle`. */
function rimPoint(e: Ellipse, angle: number, outside: number): { x: number; z: number } {
  const dx = Math.cos(angle);
  const dz = Math.sin(angle);
  const cos = Math.cos(-e.rotation);
  const sin = Math.sin(-e.rotation);
  // The ray in the ellipse's own frame, so the rim distance is the standard polar form.
  const lx = (dx * cos - dz * sin) / e.radiusX;
  const lz = (dx * sin + dz * cos) / e.radiusZ;
  const rim = 1 / Math.max(Math.hypot(lx, lz), 1e-6);
  return { x: e.x + dx * (rim + outside), z: e.z + dz * (rim + outside) };
}

/**
 * Where a decorative footbridge goes, or null.
 *
 * Spec D6: the arched footbridge is built as drawn and spans water **nothing drives across**, which
 * is what keeps it free of §2.2's autostep arithmetic. So a pond is only bridged when it clears the
 * corridor entirely -- a bridge on the driving line would be a promise the physics cannot keep.
 *
 * One per hole at most: this is dressing on a stream at the hole's edge, not a crossing.
 */
function bridgeSite(spec: HoleSpec, spline: ReturnType<typeof createSpline>): { x: number; z: number; yaw: number } | null {
  for (const pond of spec.water) {
    const centre = centroid(pond);
    const nearest = spline.nearest(centre.x, centre.z);
    const clearance = Math.max(...spec.corridor) + BRIDGE_CORRIDOR_CLEARANCE_M;
    if (nearest.distance < clearance) continue;

    // Across the pond's narrower axis, which is the span a real bridge takes.
    const extent = extents(pond);
    if (Math.min(extent.x, extent.z) < BRIDGE_MIN_SPAN_M) continue;
    const yaw = extent.x <= extent.z ? 0 : Math.PI / 2;
    return { x: centre.x, z: centre.z, yaw };
  }
  return null;
}

function centroid(polygon: Polygon): { x: number; z: number } {
  let x = 0;
  let z = 0;
  for (const point of polygon.points) {
    x += point.x;
    z += point.z;
  }
  const n = Math.max(polygon.points.length, 1);
  return { x: x / n, z: z / n };
}

function extents(polygon: Polygon): { x: number; z: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of polygon.points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  return { x: maxX - minX, z: maxZ - minZ };
}

/**
 * Corridor half-width at `t`, interpolated between the per-control-point values. The same rule
 * `terrain.ts` uses, restated here rather than exported from the sim: this is a render-side read of
 * spec data and must not become a reason for `src/sim/**` to grow an export for the renderer.
 */
function halfWidthAt(corridor: readonly number[], t: number): number {
  if (corridor.length === 0) return 15;
  if (corridor.length === 1) return corridor[0]!;
  const scaled = Math.min(Math.max(t, 0), 1) * (corridor.length - 1);
  const i = Math.min(Math.floor(scaled), corridor.length - 2);
  const f = scaled - i;
  return corridor[i]! + (corridor[i + 1]! - corridor[i]!) * f;
}
