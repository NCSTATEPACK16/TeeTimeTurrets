import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CART_GRAPH, CART_SLOTS } from "./cartGraph";
import { buildGraph } from "./primitiveGraph";
import { TURRET_GEOMETRY } from "../sim/entities/Cart";

/**
 * `cart.json` is authored in Blender and re-exported by hand, so nothing in the type system stops
 * a re-export from quietly moving a part. These are the invariants a re-export must not break.
 *
 * The turret ones are not cosmetic. `sim/entities/Cart.ts` `computeMuzzle` derives where a shot
 * originates from `TURRET_GEOMETRY`, and the renderer draws the club head from this graph. If the
 * two disagree the ball leaves from somewhere the player is not looking -- and it looks like a
 * physics bug, not an art bug, which is the expensive way to find it.
 */

function worldOf(built: ReturnType<typeof buildGraph>, name: string): THREE.Vector3 {
  built.root.updateMatrixWorld(true);
  const node = built.named.get(name);
  if (!node) throw new Error(`no node named ${name}`);
  return node.getWorldPosition(new THREE.Vector3());
}

describe("the cart graph matches what the sim believes about the cart", () => {
  it("puts the turret pivot at TURRET_GEOMETRY.pivotHeight above the ground", () => {
    const built = buildGraph(CART_GRAPH);
    expect(worldOf(built, "turret_pivot").y).toBeCloseTo(TURRET_GEOMETRY.pivotHeight, 3);
    built.dispose();
  });

  it("puts the club head TURRET_GEOMETRY.barrelLength along the barrel from the pitch axis", () => {
    const built = buildGraph(CART_GRAPH);
    const pitch = worldOf(built, "barrel_pitch");
    const head = worldOf(built, "head_slot");
    expect(head.distanceTo(pitch)).toBeCloseTo(TURRET_GEOMETRY.barrelLength, 3);
    built.dispose();
  });

  it("stands the cart on the ground -- the group origin is the ground-contact centre", () => {
    const built = buildGraph(CART_GRAPH);
    built.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(built.root);
    // Wheels touch y=0. A graph re-exported with a stale parent offset floats or sinks the cart,
    // which the chase camera then frames wrongly for the whole round.
    expect(box.min.y).toBeCloseTo(0, 2);
    built.dispose();
  });

  it("faces +Z: the barrel points the way the cart drives", () => {
    const built = buildGraph(CART_GRAPH);
    const head = worldOf(built, "head_slot");
    expect(head.z).toBeGreaterThan(1);
    expect(Math.abs(head.x)).toBeLessThan(0.05);
    built.dispose();
  });
});

describe("material slots", () => {
  it("declares exactly the eight slots ASSET_PIPELINE.md section 2.1 names", () => {
    expect(Object.keys(CART_GRAPH.slots).sort()).toEqual([
      "chassis",
      "club_bag",
      "rims",
      "roof",
      "seats",
      "tires",
      "turret_barrel",
      "turret_housing",
    ]);
  });

  it("uses every declared slot -- an unused slot is a swatch that paints nothing", () => {
    const used = new Set<string>();
    const walk = (n: { slot: string; children?: readonly unknown[] }): void => {
      used.add(n.slot);
      for (const c of n.children ?? []) walk(c as typeof n);
    };
    walk(CART_GRAPH.root);
    expect([...used].sort()).toEqual(Object.keys(CART_GRAPH.slots).sort());
  });

  it("exposes the slot names as a typed constant the loadout can key off", () => {
    expect(CART_SLOTS).toContain("chassis");
    expect(CART_SLOTS).toContain("turret_housing");
    expect(CART_SLOTS).toHaveLength(8);
  });
});

describe("the parts the renderer addresses by name", () => {
  it.each(["turret_pivot", "barrel_pitch", "head_slot", "head_putter", "head_iron", "head_driver"])(
    "carries a node named %s",
    (name) => {
      const built = buildGraph(CART_GRAPH);
      expect(built.named.get(name)).toBeDefined();
      built.dispose();
    },
  );

  it("carries four wheels, each with a rim as its child so the rim rolls with it", () => {
    const built = buildGraph(CART_GRAPH);
    for (const tag of ["fl", "fr", "rl", "rr"]) {
      const wheel = built.named.get(`wheel_${tag}`);
      expect(wheel, `wheel_${tag}`).toBeDefined();
      expect(built.named.get(`rim_${tag}`)?.parent).toBe(wheel);
    }
    built.dispose();
  });
});
