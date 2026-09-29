import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildGraph, mergeGraph } from "./primitiveGraph";
import type { PrimitiveGraph, PrimitiveNode } from "./primitiveGraph";

/** Smoke check for the `prism` kind (`docs/art/specs/00-pipeline.md`). */

const SLOTS: PrimitiveGraph["slots"] = { roof: { color: 0x7f9a88, roughness: 0.7, metalness: 0 } };

function prism(params: number[], children?: PrimitiveNode[]): PrimitiveGraph {
  const root: PrimitiveNode = {
    name: "roof",
    kind: "prism",
    params,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    slot: "roof",
    children,
  };
  return { name: "test", version: 1, units: "m", slots: SLOTS, root };
}

describe("prism kind", () => {
  it("extrudes the polygon by depth, centred on z", () => {
    const built = buildGraph(prism([0.5, 0, 0, 1, 0, 0, 2]));
    const box = new THREE.Box3().setFromObject(built.root);
    expect(box.min.toArray()).toEqual([0, 0, -0.25]);
    expect(box.max.toArray()).toEqual([1, 2, 0.25]);
    built.dispose();
  });

  it("merges alongside an indexed box", () => {
    const withBox = prism([0.5, 0, 0, 1, 0, 0, 2], [
      { name: "b", kind: "box", params: [1, 1, 1], position: [3, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], slot: "roof" },
    ]);
    const merged = mergeGraph(withBox);
    // 12 triangles from the box, 8 from the triangular prism (2 caps + 3 quad sides).
    expect(merged.mesh.geometry.index!.count / 3).toBe(12 + 8);
    merged.dispose();
  });

  it.each([
    ["zero depth", [0, 0, 0, 1, 0, 0, 2]],
    ["two points", [0.5, 0, 0, 1, 0]],
    ["odd coordinate count", [0.5, 0, 0, 1, 0, 0]],
  ])("rejects %s at load", (_label, params) => {
    expect(() => buildGraph(prism(params))).toThrow(/prism "roof" needs \[depth > 0/);
  });
});
