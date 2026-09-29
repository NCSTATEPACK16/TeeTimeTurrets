import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildGraph } from "./primitiveGraph";
import { pickupGraph, PICKUP_TYPES } from "./kitGraphs";

/** Smoke check for the pickup items (`docs/art/specs/pickups.md`). */
describe.each(PICKUP_TYPES)("pickup %s", (type) => {
  it("is 0.80 m at its longest, centred on its origin, and <= 200 tris", () => {
    const built = buildGraph(pickupGraph(type));
    built.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(built.root);
    let triangles = 0;
    built.root.traverse((o) => {
      if (o instanceof THREE.Mesh) triangles += o.geometry.index!.count / 3;
    });
    built.dispose();
    const size = box.getSize(new THREE.Vector3());
    expect(Math.max(size.x, size.y, size.z)).toBeGreaterThan(0.75);
    expect(Math.max(size.x, size.y, size.z)).toBeLessThan(0.85);
    expect(box.getCenter(new THREE.Vector3()).length()).toBeLessThan(0.1);
    expect(triangles).toBeLessThanOrEqual(200);
  });
});
