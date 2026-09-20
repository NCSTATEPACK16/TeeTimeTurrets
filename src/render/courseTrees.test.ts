import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createCourseTrees } from "./courseTrees";
import { generateCourse } from "../sim/course";
import { solveCourseLayout } from "../sim/courseLayout";
import { createCourseSurfaces } from "../sim/courseSurfaces";
import { createCourseTerrain } from "../sim/courseTerrain";
import type { CourseTerrain, PlacedHole } from "../sim/courseTerrain";
import { createSurfaces, createSurfaceWeights } from "../sim/surfaces";
import type { Surfaces } from "../sim/surfaces";
import { createTerrain, WOODS_WEIGHT } from "../sim/terrain";
import { mulberry32 } from "../sim/rng";

/**
 * The scatter's *placement rule* is what matters here (there is no WebGL in the node env, so how a
 * tree looks is the Scene Gate's job): a tree belongs in the rough of some hole, never on a mown
 * fairway/green, in a bunker, or in the water. Guards the arena's answer to the barren course.
 */

const COURSE_SEED = 2026;
const TEST_HOLES = 3;

function build(seed = COURSE_SEED): { terrain: CourseTerrain; surfaces: Surfaces } {
  const generated = generateCourse(seed, TEST_HOLES);
  const layout = solveCourseLayout(
    generated.holes.map((h) => ({ index: h.index, tee: h.tee, cup: h.cup, control: h.control })),
  );
  const placed: PlacedHole[] = layout.placements.map((placement) => {
    const spec = generated.holes[placement.index]!;
    return { placement, spec, terrain: createTerrain(spec) };
  });
  const terrain = createCourseTerrain(placed, { rough: mulberry32(seed) });
  const surfaces = createCourseSurfaces(
    terrain,
    placed.map((hole) => createSurfaces(hole.spec, hole.terrain)),
  );
  return { terrain, surfaces };
}

function instancePositions(group: THREE.Group): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const m = new THREE.Matrix4();
  for (const child of group.children) {
    const mesh = child as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh) continue;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      out.push(new THREE.Vector3().setFromMatrixPosition(m));
    }
  }
  return out;
}

describe("createCourseTrees", () => {
  it("scatters wood across the course rough", () => {
    const { terrain, surfaces } = build();
    const trees = createCourseTrees(terrain, surfaces, COURSE_SEED);
    expect(trees.count, "a course with rough grew no trees at all").toBeGreaterThan(0);
    expect(trees.count).toBe(instancePositions(trees.group).length);
    expect(trees.group.children.length, "one instanced draw per biome, no more").toBeLessThanOrEqual(3);
    trees.dispose();
  });

  it("places every tree in the rough, never on the mown corridor, sand, or water", () => {
    const { terrain, surfaces } = build();
    const trees = createCourseTrees(terrain, surfaces, COURSE_SEED);
    const weights = createSurfaceWeights();
    for (const p of instancePositions(trees.group)) {
      surfaces.weightsAt(p.x, p.z, weights);
      // WOODS_WEIGHT is the same threshold `placement.ts` keeps bunkers below, so trees and sand
      // never share ground. A tree on the fairway (corridor < WOODS_WEIGHT) is the barren-course
      // bug's opposite failure -- wood growing through a mown lane.
      expect(weights.corridor, `tree at ${p.x.toFixed(1)},${p.z.toFixed(1)} on the corridor`).toBeGreaterThanOrEqual(
        WOODS_WEIGHT,
      );
      expect(weights.sand).not.toBe(1);
      expect(weights.water).not.toBe(1);
    }
    trees.dispose();
  });

  it("is deterministic in the seed, so every machine grows the same wood", () => {
    const a = build();
    const b = build();
    const treesA = createCourseTrees(a.terrain, a.surfaces, COURSE_SEED);
    const treesB = createCourseTrees(b.terrain, b.surfaces, COURSE_SEED);
    expect(treesB.count).toBe(treesA.count);
    const pa = instancePositions(treesA.group);
    const pb = instancePositions(treesB.group);
    expect(pb[0]!.toArray()).toEqual(pa[0]!.toArray());
    expect(pb[pb.length - 1]!.toArray()).toEqual(pa[pa.length - 1]!.toArray());
    treesA.dispose();
    treesB.dispose();
  });
});
