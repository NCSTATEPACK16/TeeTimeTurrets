import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildGraph } from "./primitiveGraph";
import { TREE_SPECIES, treeGraph, type TreeSpecies } from "./envGraphs";
import { fixedHoleSpec } from "../sim/course";
import { createTerrain } from "../sim/terrain";
import { createSurfaces } from "../sim/surfaces";
import { createTrees } from "../render/Trees";

/**
 * Stage 5a smoke check for `trees.json` (`docs/art/specs/stage5/trees.md`). Each species is authored
 * at unit height with its origin at ground contact, because `Trees.ts` scales every instance by the
 * biome's `treeHeight`: a species 1.2 tall would be a 20% taller wood with nothing else failing.
 */

const ALL: readonly TreeSpecies[] = Object.values(TREE_SPECIES).flat();

function measure(name: TreeSpecies): { box: THREE.Box3; triangles: number } {
  const built = buildGraph(treeGraph(name));
  built.root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(built.root);
  let triangles = 0;
  built.root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const geometry = child.geometry as THREE.BufferGeometry;
    triangles += (geometry.getIndex()?.count ?? geometry.getAttribute("position").count) / 3;
  });
  built.dispose();
  return { box, triangles };
}

describe("tree species", () => {
  it("has two species for every tree form", () => {
    expect(ALL).toHaveLength(6);
  });

  it.each(ALL)("%s stands 1.0 tall on its origin within the 200-triangle budget", (name) => {
    const { box, triangles } = measure(name);
    expect(box.max.y).toBeGreaterThan(0.98);
    expect(box.max.y).toBeLessThan(1.02);
    expect(Math.abs(box.min.y)).toBeLessThan(0.01);
    expect(triangles).toBeLessThanOrEqual(200);
  });

  it.each(TREE_SPECIES.shrub)("links %s is scrub: wider than it is tall", (name) => {
    const { box } = measure(name);
    const size = box.getSize(new THREE.Vector3());
    expect(Math.max(size.x, size.z)).toBeGreaterThan(size.y);
  });

  it("plants both species on the fixed hole without moving a single tree", () => {
    // The species bit comes from its own stream. Drawing it from placement's would shift every
    // later cell's draws, so the count and the positions below -- recorded from the one-species
    // wood before this stage -- are what would move.
    const spec = fixedHoleSpec();
    const terrain = createTerrain(spec);
    const trees = createTrees(terrain, createSurfaces(spec, terrain));

    expect(trees.meshes).toHaveLength(2);
    for (const mesh of trees.meshes) expect(mesh.count).toBeGreaterThan(0);
    expect(trees.count).toBe(101);

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    let sum = 0;
    for (const mesh of trees.meshes) {
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix);
        position.setFromMatrixPosition(matrix);
        sum += position.x + position.z;
      }
    }
    expect(sum).toBeCloseTo(777.819, 2);
    trees.dispose();
  });
});
