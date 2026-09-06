import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { fixedHoleSpec } from "../sim/course";
import type { HoleSpec } from "../sim/course";
import { createTerrain } from "../sim/terrain";
import { createSurfaceWeights, createSurfaces } from "../sim/surfaces";
import { BIOMES } from "./biomes";
import { createTrees } from "./Trees";

/**
 * A render-layer test, which is why it may import three -- the node environment exists to catch a
 * three import into `src/sim/**` or `src/physics/**`, not to ban it here. Nothing below touches
 * WebGL: geometry, matrices and InstancedMesh are all plain data until a renderer draws them.
 *
 * These guard placement rules rather than drive new code, so per AGENTS.md each one was checked
 * by breaking the thing it guards and watching it go red.
 */

function build(overrides: Partial<HoleSpec> = {}) {
  const spec: HoleSpec = { ...fixedHoleSpec(), ...overrides };
  const terrain = createTerrain(spec);
  const surfaces = createSurfaces(spec, terrain);
  return { spec, terrain, surfaces, trees: createTrees(terrain, surfaces) };
}

describe("createTrees", () => {
  it("draws the whole wood as one instanced mesh", () => {
    // The budget rule that matters at this fidelity is draw calls, not triangles. If this ever
    // becomes a group of per-tree meshes, the frame cost goes up by orders of magnitude while
    // every triangle-count check still passes.
    const { trees } = build();
    expect(trees.count).toBeGreaterThan(0);
    expect(trees.mesh).toBeInstanceOf(THREE.InstancedMesh);
    expect(trees.mesh!.count).toBe(trees.count);
    trees.dispose();
  });

  it("plants only in rough, never on the mown corridor", () => {
    const { terrain, surfaces, trees } = build();
    const weights = createSurfaceWeights();
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();

    expect(trees.count).toBeGreaterThan(20); // or the loop below proves nothing

    for (let i = 0; i < trees.count; i++) {
      trees.mesh!.getMatrixAt(i, matrix);
      position.setFromMatrixPosition(matrix);
      surfaces.weightsAt(position.x, position.z, weights);
      expect(weights.corridor).toBeGreaterThanOrEqual(0.92);
      expect(weights.sand).toBe(0);
      expect(weights.water).toBe(0);
      expect(position.y).toBeGreaterThan(terrain.spec.waterLevel);
    }
    trees.dispose();
  });

  it("stands every trunk on the ground, not floating or buried", () => {
    const { terrain, trees } = build();
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    for (let i = 0; i < trees.count; i++) {
      trees.mesh!.getMatrixAt(i, matrix);
      position.setFromMatrixPosition(matrix);
      // 4 decimals, not more: instanceMatrix is a Float32 buffer, so a read-back carries ~1e-7
      // of relative error. A tenth of a millimetre still says "standing on the ground".
      expect(position.y).toBeCloseTo(terrain.heightAt(position.x, position.z), 4);
    }
    trees.dispose();
  });

  it("is deterministic in the hole seed", () => {
    const a = build();
    const b = build();
    expect(a.trees.count).toBe(b.trees.count);

    const ma = new THREE.Matrix4();
    const mb = new THREE.Matrix4();
    for (let i = 0; i < a.trees.count; i += 7) {
      a.trees.mesh!.getMatrixAt(i, ma);
      b.trees.mesh!.getMatrixAt(i, mb);
      expect(Array.from(ma.elements)).toEqual(Array.from(mb.elements));
    }
    a.trees.dispose();
    b.trees.dispose();
  });

  it("grows a different wood for a different seed", () => {
    // Deliberately NOT claiming to prove the channel-3 split: two seeds produce different counts
    // whichever channel placement draws from, so a test worded that way would pass while the
    // property it named was broken. What this does establish is that placement is seed-driven
    // rather than a fixed pattern reused by every hole.
    const base = build();
    const other = build({ seed: fixedHoleSpec().seed ^ 0x9e3779b9 });
    expect(other.trees.count).not.toBe(base.trees.count);
    base.trees.dispose();
    other.trees.dispose();
  });

  it("thins the wood on links and thickens it in parkland, per the biome table", () => {
    expect(BIOMES.parkland.treeDensity).toBeGreaterThan(BIOMES.marsh.treeDensity);
    expect(BIOMES.marsh.treeDensity).toBeGreaterThan(BIOMES.links.treeDensity);

    const parkland = build({ biome: "parkland" });
    const links = build({ biome: "links" });
    const marsh = build({ biome: "marsh" });

    expect(parkland.trees.count).toBeGreaterThan(marsh.trees.count);
    expect(marsh.trees.count).toBeGreaterThan(links.trees.count);

    parkland.trees.dispose();
    links.trees.dispose();
    marsh.trees.dispose();
  });

  it("bakes two foliage tones and a trunk colour into the merged geometry", () => {
    // The flat-shaded look is two tones per form. One merged geometry with vertex colours is
    // what lets that survive instancing without a second material or a second draw.
    const { trees } = build();
    const colour = trees.mesh!.geometry.getAttribute("color");
    expect(colour).toBeDefined();

    const seen = new Set<string>();
    for (let i = 0; i < colour.count; i++) {
      seen.add(`${colour.getX(i).toFixed(4)},${colour.getY(i).toFixed(4)},${colour.getZ(i).toFixed(4)}`);
    }
    expect(seen.size).toBe(3);
    trees.dispose();
  });
});
