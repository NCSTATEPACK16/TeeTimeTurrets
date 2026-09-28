import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createCourseTrees } from "./courseTrees";
import { createSurfaceWeights } from "../sim/surfaces";
import { WOODS_WEIGHT } from "../sim/terrain";
import { miniCourse } from "../sim/testing/miniCourse";

/**
 * The scatter's placement rule is what matters here (there is no WebGL in the node env, so how a
 * tree looks is the Scene Gate's job): a tree belongs in rough, never on a mown fairway or green,
 * in a bunker, or in the water; and a cap thins the whole course evenly rather than filling it
 * from one side until it runs out.
 */

const SEED = 2026;

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
  const { terrain, surfaces } = miniCourse(6, 8, SEED);

  it("scatters wood across the course rough, one draw per biome", () => {
    const trees = createCourseTrees(terrain, surfaces, SEED, 5000);
    expect(trees.count).toBeGreaterThan(200);
    expect(trees.count).toBe(instancePositions(trees.group).length);
    expect(trees.group.children.length).toBeLessThanOrEqual(3);
    trees.dispose();
  });

  it("places every tree in the rough, never on the mown corridor, sand, or water", () => {
    const trees = createCourseTrees(terrain, surfaces, SEED, 5000);
    const weights = createSurfaceWeights();
    for (const p of instancePositions(trees.group)) {
      surfaces.weightsAt(p.x, p.z, weights);
      expect(weights.corridor).toBeGreaterThanOrEqual(WOODS_WEIGHT);
      expect(weights.sand).not.toBe(1);
      expect(weights.water).not.toBe(1);
    }
    trees.dispose();
  });

  it("thins to the cap across the whole course, not by filling one end first", () => {
    const full = instancePositions(createCourseTrees(terrain, surfaces, SEED, 100000).group);
    const capped = createCourseTrees(terrain, surfaces, SEED, 150);
    expect(capped.count).toBeLessThanOrEqual(150);
    expect(capped.count).toBeGreaterThan(140);
    const midZ = (terrain.bounds.minZ + terrain.bounds.maxZ) / 2;
    const share = (ps: THREE.Vector3[]): number => ps.filter((p) => p.z > midZ).length / ps.length;
    expect(Math.abs(share(instancePositions(capped.group)) - share(full))).toBeLessThan(0.15);
    capped.dispose();
  });

  it("is deterministic in the seed, so every machine grows the same wood", () => {
    const a = instancePositions(createCourseTrees(terrain, surfaces, SEED, 800).group);
    const b = instancePositions(createCourseTrees(terrain, surfaces, SEED, 800).group);
    expect(b.length).toBe(a.length);
    expect(b[0]!.toArray()).toEqual(a[0]!.toArray());
    expect(b[b.length - 1]!.toArray()).toEqual(a[a.length - 1]!.toArray());
  });
});
