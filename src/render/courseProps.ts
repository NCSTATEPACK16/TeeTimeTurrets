import * as THREE from "three";
import { Flagstick } from "../entities/Flagstick";
import { mergeGraphInstances } from "../entities/primitiveGraph";
import { graphFor } from "../entities/propGraphs";
import type { PropName } from "../entities/propGraphs";
import { toCourseFrame } from "../sim/courseGeometry";
import type { CourseTerrain } from "../sim/courseTerrain";
import { createSurfaces } from "../sim/surfaces";
import { derivePlacements } from "./props";

/**
 * The whole course's furniture, not one hole's.
 *
 * `props.ts` (`createProps`) derives a hole's tee markers, signs, yardage posts, rakes and bridges
 * in that hole's own centred frame, and the single-hole stroke-play view draws them; in the
 * eighteen-hole arena it is switched off, and the drivable course had no tee markers, no signs and
 * no pins anywhere -- only the tiled ground and the scattered wood. Every green and every tee read
 * as bare grass. This runs the same per-hole derivation over all eighteen holes, transforms each
 * placement into the course frame, and draws a flagstick at every cup, so the arena reads like the
 * course the plans draw rather than like an empty field.
 *
 * Decorative and render-only, exactly like `createProps`, `createTrees` and `treeline.ts`: no
 * collider, never read by `src/sim/**`, never replicated. The arena has no played ball and no pin
 * on the sim side, so these flagsticks are landmarks standing at each hole rather than a posed pin
 * -- they never fell, because nothing in arena knocks them down.
 *
 * **Draw-call shape.** Each prop *kind* is merged across all eighteen holes into one draw
 * (`mergeGraphInstances`, the causeway's trick applied course-wide), so the whole course's markers,
 * signs, posts, rakes and bridges cost one draw each rather than one per hole. The flagsticks are
 * the exception: `Flagstick` is a posed group with a vertex-animated pennant, not a graph, so each
 * green carries its own -- eighteen of them, the one part of this that scales with hole count.
 */

/**
 * The boardwalk is left out here. Its placement is a *segment* whose length comes from the pond it
 * spans, tiled section by section with per-section height sampling (`props.ts` `sectionMatrices`),
 * which does not reduce to the single point-and-yaw every other prop is. The causeways still tile
 * in the single-hole view; giving them course-wide decking is a separate change.
 */
function isPointProp(placement: { sections?: number }): boolean {
  return placement.sections === undefined;
}

/** One placed prop in the course (world) frame: a point, a facing, and which asset stands there. */
export interface CoursePropPlacement {
  readonly prop: PropName;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Radians about +Y, Three's convention -- the same yaw `props.ts` gives each prop. */
  readonly yaw: number;
}

/**
 * Every point prop on the course, in world metres. Pure and exported separately from the geometry
 * for the same reason `derivePlacements` is: the placement rule can be asserted without building a
 * single mesh, and the arena's answer to the barren course is a rule, not a screenshot.
 *
 * The per-hole derivation is reused wholesale -- markers flank each tee, posts sit back from each
 * cup, rakes at each bunker -- and only the frame changes: `toCourseFrame` rotates and offsets the
 * hole-local point onto the course, the yaw gains the hole's own rotation, and the height is
 * re-sampled from the *blended* course heightfield so a prop sits on the ground the cart drives on
 * rather than on the single hole's unblended terrain.
 */
export function deriveCoursePropPlacements(course: CourseTerrain): CoursePropPlacement[] {
  const out: CoursePropPlacement[] = [];
  const world = { x: 0, z: 0 };
  for (const hole of course.holes) {
    const surfaces = createSurfaces(hole.spec, hole.terrain);
    for (const local of derivePlacements(hole.terrain, surfaces)) {
      if (!isPointProp(local)) continue;
      toCourseFrame(hole.placement, local.x, local.z, world);
      out.push({
        prop: local.prop,
        x: world.x,
        y: course.heightAt(world.x, world.z),
        z: world.z,
        yaw: local.yaw + hole.placement.rotation,
      });
    }
  }
  return out;
}

/** Where a flagstick stands on each hole, in world metres -- one per cup, on the blended ground. */
export function courseFlagstickPositions(course: CourseTerrain): { x: number; y: number; z: number }[] {
  const world = { x: 0, z: 0 };
  return course.holes.map((hole) => {
    toCourseFrame(hole.placement, hole.spec.cup.x, hole.spec.cup.z, world);
    return { x: world.x, y: course.heightAt(world.x, world.z), z: world.z };
  });
}

export interface CourseProps {
  readonly group: THREE.Group;
  /** Advances every pennant to `elapsedSeconds`, the same absolute-time wave the single pin uses. */
  update(elapsedSeconds: number): void;
  dispose(): void;
}

export function createCourseProps(course: CourseTerrain): CourseProps {
  const group = new THREE.Group();
  const disposers: (() => void)[] = [];

  // Group the point placements by prop kind, then merge each kind's copies into one draw call.
  const byProp = new Map<PropName, THREE.Matrix4[]>();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const unitScale = new THREE.Vector3(1, 1, 1);
  for (const placement of deriveCoursePropPlacements(course)) {
    position.set(placement.x, placement.y, placement.z);
    quaternion.setFromAxisAngle(up, placement.yaw);
    let list = byProp.get(placement.prop);
    if (list === undefined) {
      list = [];
      byProp.set(placement.prop, list);
    }
    list.push(new THREE.Matrix4().compose(position, quaternion, unitScale));
  }
  for (const [prop, matrices] of byProp) {
    const merged = mergeGraphInstances(graphFor(prop), matrices);
    group.add(merged.mesh);
    disposers.push(() => merged.dispose());
  }

  // A flagstick at every cup. Posed groups rather than merged geometry, so they keep their waving
  // pennants; the felled state the single-hole pin carries is never set, because arena has no pin
  // to knock down.
  const flagsticks: Flagstick[] = [];
  for (const cup of courseFlagstickPositions(course)) {
    const pin = new Flagstick();
    pin.position.set(cup.x, cup.y, cup.z);
    group.add(pin);
    flagsticks.push(pin);
  }

  return {
    group,
    update: (elapsedSeconds: number): void => {
      for (const pin of flagsticks) pin.update(elapsedSeconds);
    },
    dispose: (): void => {
      for (const d of disposers) d();
      for (const pin of flagsticks) pin.dispose();
    },
  };
}
