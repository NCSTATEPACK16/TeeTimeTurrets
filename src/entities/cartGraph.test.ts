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
  it("puts barrel_pitch -- the node the club rotates about -- at TURRET_GEOMETRY's pivot", () => {
    // `pivotHeight` names THIS node, not `turret_pivot`. It used to name the yaw ring, which is
    // 0.55 m lower and is not where a shot comes from; see the constant's own comment. Asserting
    // it against the ring is what let the two drift 0.26 m apart while both tests stayed green.
    const built = buildGraph(CART_GRAPH);
    const pitch = worldOf(built, "barrel_pitch");
    expect(pitch.y, "pivot height").toBeCloseTo(TURRET_GEOMETRY.pivotHeight, 3);
    expect(pitch.z, "pivot forward").toBeCloseTo(TURRET_GEOMETRY.pivotForward, 3);
    expect(pitch.x, "pivot on the cart's centreline").toBeCloseTo(0, 3);
    built.dispose();
  });

  it("stands the yaw ring on the roof, below the pivot it carries", () => {
    // The pedestal, in one assertion: the ring is still bolted to the canopy, and the pitch axis
    // is above it. Without the gap there is no room for a near-vertical swing at all.
    const built = buildGraph(CART_GRAPH);
    const ring = worldOf(built, "turret_pivot");
    const pitch = worldOf(built, "barrel_pitch");
    expect(ring.y).toBeCloseTo(2.05, 2);
    expect(pitch.y - ring.y).toBeGreaterThan(0.5);
    // Directly above: a ring offset from its own pivot would make the muzzle depend on turret yaw
    // in a way `computeMuzzle` does not model.
    expect(ring.z, "ring under the pivot").toBeCloseTo(pitch.z, 3);
    expect(ring.x, "ring under the pivot").toBeCloseTo(pitch.x, 3);
    built.dispose();
  });

  it("puts the club head TURRET_GEOMETRY.barrelLength along the barrel from the pitch axis", () => {
    const built = buildGraph(CART_GRAPH);
    const pitch = worldOf(built, "barrel_pitch");
    const head = worldOf(built, "head_slot");
    expect(head.distanceTo(pitch)).toBeCloseTo(TURRET_GEOMETRY.barrelLength, 3);
    built.dispose();
  });

  it("hangs the pitching housing beside the barrel, never above it", () => {
    // `housing_pitch` is posed with the swing. It is only safe to pose because it is a sibling of
    // `barrel_pitch`: an ancestor would carry the muzzle with it and the ball would leave from
    // wherever the housing animation happened to be that frame.
    const built = buildGraph(CART_GRAPH);
    const housing = built.named.get("housing_pitch");
    const pitch = built.named.get("barrel_pitch");
    expect(housing, "housing_pitch").toBeDefined();
    expect(housing!.parent).toBe(pitch!.parent);
    for (let n = pitch!.parent; n; n = n.parent) expect(n).not.toBe(housing);
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

describe("the club heads hang off a hosel at the heel", () => {
  /**
   * `club-heads-01.jpg`'s most useful content, and the thing its prompt never asked for: on all
   * three clubs the shaft bends into the head at the **heel** rather than meeting it dead centre.
   * Centre-mounted heads with no hosel are most of why the shipped clubs read as blocks on sticks.
   *
   * `head_slot` stays the muzzle -- the head is what moved, not the origin of the shot.
   */
  function ownBox(node: THREE.Object3D): THREE.Box3 {
    const mesh = node as THREE.Mesh;
    mesh.geometry.computeBoundingBox();
    return mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
  }

  it.each(["head_driver", "head_iron", "head_putter"])(
    "mounts %s at its heel, under the shaft rather than centred on it",
    (name) => {
      const built = buildGraph(CART_GRAPH);
      built.root.updateMatrixWorld(true);
      const shaftTip = worldOf(built, "head_slot");
      const head = ownBox(built.named.get(name)!);
      const centre = head.getCenter(new THREE.Vector3());

      // The head's own width straddles the shaft at one end, not the middle: one edge is under
      // the shaft, and the body runs off to the toe side.
      const heelEdge = Math.max(head.min.x, head.max.x); // toe is -X, heel is +X
      expect(Math.abs(heelEdge - shaftTip.x), `${name} heel under the shaft`).toBeLessThan(0.05);
      expect(shaftTip.x - centre.x, `${name} offset to the toe`).toBeGreaterThan(0.08);
      // And below it: a head level with the shaft tip is a head with no hosel.
      expect(head.max.y).toBeLessThan(shaftTip.y);
      built.dispose();
    },
  );

  it("bridges the shaft to the heel with a hosel that touches both", () => {
    const built = buildGraph(CART_GRAPH);
    built.root.updateMatrixWorld(true);
    const hosel = built.named.get("hosel");
    expect(hosel, "hosel").toBeDefined();

    const box = ownBox(hosel!);
    const shaftTip = worldOf(built, "head_slot");
    expect(box.distanceToPoint(shaftTip), "hosel meets the shaft").toBeLessThan(0.02);
    for (const name of ["head_driver", "head_iron", "head_putter"]) {
      const head = ownBox(built.named.get(name)!);
      expect(head.distanceToPoint(box.getCenter(new THREE.Vector3())), name).toBeLessThan(0.09);
    }
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
  it.each([
    "turret_pivot",
    "turret_pedestal",
    "housing_pitch",
    "barrel_pitch",
    "head_slot",
    "head_putter",
    "head_iron",
    "head_driver",
  ])(
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
