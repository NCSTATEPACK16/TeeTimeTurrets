import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createTreeline } from "./treeline";
import { metresNorthOf } from "../sim/courseBarrier";
import type { SouthBoundary } from "../sim/courseBarrier";
import type { Bounds } from "../sim/courseLayout";
import type { Treeline } from "./treeline";

/** Every tree's position, across both species' meshes. */
function positions(band: Treeline): THREE.Vector3[] {
  const matrix = new THREE.Matrix4();
  const out: THREE.Vector3[] = [];
  for (const mesh of band.meshes) {
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      out.push(new THREE.Vector3().setFromMatrixPosition(matrix));
    }
  }
  return out;
}

/** Diagonal, like the real one: a band placed with a z-only offset would be caught by this. */
const ROAD: SouthBoundary = { a: { x: -600, z: -400 }, b: { x: 400, z: -680 } };
const BOUNDS: Bounds = { minX: -750, minZ: -720, maxX: 760, maxZ: 500 };
const FLAT = (): number => 3;

describe("the treeline", () => {
  it("plants every tree on the road side of the boundary", () => {
    /**
     * The band is scenery beyond a barrier the cart cannot cross. A tree on the *playing* side is a
     * tree in the fairway -- and since it has no collider, it would be a tree the ball flies
     * through, which reads as a bug rather than as decoration.
     */
    const band = createTreeline(ROAD, BOUNDS, FLAT, 2026);
    expect(band.count).toBeGreaterThan(0);

    for (const [i, position] of positions(band).entries()) {
      expect(
        metresNorthOf(ROAD, position.x, position.z),
        `tree ${i} at (${position.x.toFixed(0)}, ${position.z.toFixed(0)})`,
      ).toBeLessThan(0);
    }
    band.dispose();
  });

  it("runs the length of the road and past both ends", () => {
    // A band that stopped at the road's own ends would leave the corners open to the skybox.
    const band = createTreeline(ROAD, BOUNDS, FLAT, 2026);
    let minAlong = Infinity;
    let maxAlong = -Infinity;
    const length = Math.hypot(ROAD.b.x - ROAD.a.x, ROAD.b.z - ROAD.a.z);
    const ax = (ROAD.b.x - ROAD.a.x) / length;
    const az = (ROAD.b.z - ROAD.a.z) / length;

    for (const position of positions(band)) {
      const along = (position.x - ROAD.a.x) * ax + (position.z - ROAD.a.z) * az;
      minAlong = Math.min(minAlong, along);
      maxAlong = Math.max(maxAlong, along);
    }
    expect(minAlong).toBeLessThan(0);
    expect(maxAlong).toBeGreaterThan(length);
    band.dispose();
  });

  it("is the same band on the same seed and a different one on another", () => {
    // Placement is seeded, like `Trees.ts`'s, so a scene-gate screenshot means something.
    const a = createTreeline(ROAD, BOUNDS, FLAT, 2026);
    const b = createTreeline(ROAD, BOUNDS, FLAT, 2026);
    const c = createTreeline(ROAD, BOUNDS, FLAT, 2027);
    expect(a.count).toBe(b.count);

    const read = (band: Treeline): number[] => positions(band).flatMap((p) => [p.x, p.z]);
    expect(read(a)).toEqual(read(b));
    expect(read(a)).not.toEqual(read(c));
    a.dispose();
    b.dispose();
    c.dispose();
  });

  it("frees its geometries and material", () => {
    // AGENTS.md's resource rule. An InstancedMesh left behind is a GPU buffer per arena entered.
    const band = createTreeline(ROAD, BOUNDS, FLAT, 2026);
    expect(band.meshes).toHaveLength(2);
    let disposed = 0;
    for (const mesh of band.meshes) mesh.geometry.addEventListener("dispose", () => { disposed += 1; });
    // Both species share one material, so it is counted once.
    (band.meshes[0]!.material as THREE.Material).addEventListener("dispose", () => { disposed += 1; });
    band.dispose();
    expect(disposed).toBe(3);
  });

  it("plants nothing rather than floating a wood on a heightfield that has no heights", () => {
    // `heightAt` returning NaN outside its field is the shape this guards: a NaN matrix makes the
    // whole InstancedMesh vanish, which looks like the band was never built.
    const band = createTreeline(ROAD, BOUNDS, () => Number.NaN, 2026);
    expect(band.count).toBe(0);
    expect(band.meshes).toHaveLength(0);
    band.dispose();
  });
});
