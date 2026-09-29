import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildGraph } from "./primitiveGraph";
import { kitGraph, KIT_NAMES, type KitName } from "./kitGraphs";

/** Smoke check for the clubhouse kit export (`docs/art/specs/clubhouse.md` and siblings). */

function measure(name: KitName): { box: THREE.Box3; triangles: number } {
  const built = buildGraph(kitGraph(name));
  built.root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(built.root);
  let triangles = 0;
  built.root.traverse((o) => {
    if (o instanceof THREE.Mesh) triangles += o.geometry.index!.count / 3;
  });
  built.dispose();
  return { box, triangles };
}

const size = (b: THREE.Box3): number[] => b.getSize(new THREE.Vector3()).toArray().map((v) => +v.toFixed(2));

describe("clubhouse kit", () => {
  it("builds every graph in the set", () => {
    for (const name of KIT_NAMES) expect(() => measure(name), name).not.toThrow();
  });

  it("clubhouse: 24 m wide, plinth 14 m deep plus the entrance steps, 7.6 m to the cupola, <= 3,000 tris", () => {
    const { box, triangles } = measure("clubhouse");
    expect(box.max.x - box.min.x).toBeCloseTo(24.4, 1); // verandah roof eaves overhang the 24 m plinth by 0.2 each side
    expect(box.min.z).toBeCloseTo(-7.4, 1); // rear roof overhang
    expect(box.max.z).toBeCloseTo(7.9, 1); // bottom step
    expect(box.max.y).toBeCloseTo(7.6, 1);
    expect(triangles).toBeLessThanOrEqual(3000);
  });

  it("team barn: 8 x 24 m footprint within its roof overhang, <= 800 tris", () => {
    const { box, triangles } = measure("team_barn");
    expect(box.max.z - box.min.z).toBeCloseTo(24.8, 1);
    expect(box.max.x - box.min.x).toBeGreaterThan(8);
    expect(box.max.x - box.min.x).toBeLessThan(9);
    expect(triangles).toBeLessThanOrEqual(800);
  });

  it("lamp: 5.4 m tall, <= 120 tris", () => {
    const { box, triangles } = measure("lamp_post");
    expect(box.max.y - box.min.y).toBeCloseTo(5.4, 1);
    expect(triangles).toBeLessThanOrEqual(120);
  });

  it("food cart: 2.6 long, 2.1 tall, <= 400 tris", () => {
    const { box, triangles } = measure("food_cart");
    expect(size(box)[0]).toBeCloseTo(2.6, 1);
    expect(box.max.y).toBeCloseTo(2.1, 1);
    expect(triangles).toBeLessThanOrEqual(400);
  });
});
