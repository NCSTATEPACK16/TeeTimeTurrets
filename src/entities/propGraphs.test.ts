import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CART_SLOTS } from "./cartGraph";
import { PROP_NAMES, PROP_SET, PROP_SLOTS, graphFor } from "./propGraphs";
import { buildGraph, mergeGraph } from "./primitiveGraph";

/**
 * `props.json` is authored in Blender and re-exported by hand, so nothing in the type system stops
 * a re-export from quietly dropping a prop or renaming a slot. These are the invariants a re-export
 * must not break -- the same job `cartGraph.test.ts` does for the cart, and mirroring its shape.
 *
 * The silhouettes are `npm run gate`'s, not this file's. What is here is everything a picture
 * cannot see: that the set is complete, that the slot vocabularies stay disjoint, and that every
 * prop stands on the ground rather than floating above it or sunk into it.
 */

function worldBox(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(root);
}

/** Heights read against the cart, not against the sheet: `prop-silhouettes-01.jpg` scales every
 *  prop to fill its own cell, so it gives proportion within a prop and never scale between two.
 *  The cart's canopy is at 2.05 m and its turret pivot at 2.60 m. */
const EXPECTED_HEIGHT_M: Readonly<Record<string, [number, number]>> = {
  tee_marker: [0.2, 0.45],
  bunker_rake: [1.3, 1.8],
  ball_washer: [0.9, 1.3],
  distance_post: [0.9, 1.3],
  cart_path_sign: [1.1, 1.6],
  // A footbridge is a span, not a post: its height is the railing above the arch.
  footbridge: [1.2, 2.0],
};

describe("the prop set", () => {
  it("carries every prop the placement code and the gate name", () => {
    expect(Object.keys(PROP_SET.props).sort()).toEqual([...PROP_NAMES].sort());
  });

  it("declares exactly the five prop slots and shares none with the cart", () => {
    // `cartGraph.test.ts` asserts the cart declares *exactly* eight slots, and the clubhouse
    // loadout paints in that vocabulary. A prop slot colliding with one of those names would make
    // a chassis repaint reach a bunker rake.
    expect(Object.keys(PROP_SET.slots).sort()).toEqual([...PROP_SLOTS].sort());
    for (const slot of PROP_SLOTS) {
      expect(CART_SLOTS as readonly string[]).not.toContain(slot);
      // The rider's four, which are not exported as a list anywhere.
      expect(["skin", "shirt", "trousers", "cap"]).not.toContain(slot);
    }
  });

  it("uses only slots it declares, on every node of every prop", () => {
    for (const name of PROP_NAMES) {
      const graph = graphFor(name);
      const stack = [graph.root];
      while (stack.length > 0) {
        const node = stack.pop()!;
        expect(Object.keys(graph.slots), `${name}/${node.name}`).toContain(node.slot);
        stack.push(...(node.children ?? []));
      }
    }
  });

  it("builds every prop, at a size that reads against the cart", () => {
    for (const name of PROP_NAMES) {
      const built = buildGraph(graphFor(name));
      const box = worldBox(built.root);
      const [min, max] = EXPECTED_HEIGHT_M[name]!;
      expect(box.max.y - box.min.y, `${name} height`).toBeGreaterThanOrEqual(min);
      expect(box.max.y - box.min.y, `${name} height`).toBeLessThanOrEqual(max);
      built.dispose();
    }
  });

  it("stands every prop on y = 0, so placement is the terrain height and nothing else", () => {
    // The graph root carries its own offset (art/README.md), which is exactly how the rider came
    // out sitting on the floor. A prop whose origin is not its ground contact would be placed
    // buried or hovering, on every hole, and no silhouette gate would show it.
    for (const name of PROP_NAMES) {
      const built = buildGraph(graphFor(name));
      const box = worldBox(built.root);
      // At or just below zero: a tee marker's spike and a bridge's abutments are meant to be in
      // the ground. Nothing may float.
      expect(box.min.y, `${name} sits into the ground`).toBeLessThanOrEqual(0.001);
      expect(box.min.y, `${name} is not buried`).toBeGreaterThan(-0.6);
      expect(box.max.y, `${name} stands above the ground`).toBeGreaterThan(0.15);
      built.dispose();
    }
  });

  it("merges each prop to a single draw call with its colours intact", () => {
    // D7's whole purpose, checked on the real graphs rather than on a fixture: a dozen prop
    // instances on a hole is ~60 draws unmerged and ~12 merged.
    for (const name of PROP_NAMES) {
      const merged = mergeGraph(graphFor(name));
      let meshes = 0;
      merged.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) meshes++;
      });
      expect(meshes, `${name} draw calls`).toBe(1);

      const colour = merged.mesh.geometry.getAttribute("color");
      const seen = new Set<string>();
      for (let i = 0; i < colour.count; i++) {
        seen.add(`${colour.getX(i).toFixed(3)},${colour.getY(i).toFixed(3)},${colour.getZ(i).toFixed(3)}`);
      }
      // Every prop on the sheet is at least two tones; a single colour means the merge flattened it.
      expect(seen.size, `${name} tones`).toBeGreaterThanOrEqual(2);
      merged.dispose();
    }
  });

  it("keeps the footbridge's arch, which is the whole of its silhouette", () => {
    // A flat deck would still pass every count above. The apex has to be above the ends.
    const built = buildGraph(graphFor("footbridge"));
    built.root.updateMatrixWorld(true);
    const deck = (name: string): number => {
      const node = built.named.get(name);
      if (!node) throw new Error(`no node ${name}`);
      return node.getWorldPosition(new THREE.Vector3()).y;
    };
    expect(deck("bridge_deck_c")).toBeGreaterThan(deck("bridge_deck_0") + 0.2);
    expect(deck("bridge_deck_c")).toBeGreaterThan(deck("bridge_deck_6") + 0.2);
    built.dispose();
  });

  it("refuses a prop name the export does not carry, rather than drawing nothing", () => {
    expect(() => graphFor("boardwalk" as never)).toThrow(/props\.json has no prop named/);
  });
});
