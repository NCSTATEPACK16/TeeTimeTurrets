import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { DRIVER_GRAPH, DRIVER_SLOTS } from "./driverGraph";
import { CART_GRAPH } from "./cartGraph";
import { buildGraph } from "./primitiveGraph";

/**
 * `driver.json` is authored in Blender beside the cart and exported the same way, so the same
 * class of silent re-export damage applies. What is different here is that the rider is posed
 * against *the cart's* measurements -- the seat he sits on, the wheel he holds, the canopy his
 * head has to clear -- and none of that is in his own graph. These are the checks that keep the
 * two files agreeing after either one is re-exported.
 */

function build() {
  const driver = buildGraph(DRIVER_GRAPH);
  driver.root.updateMatrixWorld(true);
  return driver;
}

/**
 * One node's own world box, excluding its children. `Box3.setFromObject` walks the subtree, and
 * every part of both graphs hangs off a single root -- so it answers "where is the whole cart"
 * for any node you ask it about, which is a very convincing way to measure nothing.
 */
function ownBox(node: THREE.Object3D): THREE.Box3 {
  const mesh = node as THREE.Mesh;
  mesh.geometry.computeBoundingBox();
  return mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
}

/**
 * The cart part's *world* box, which is the only frame the two graphs share. Reading a position
 * straight out of `cart.json` gives a coordinate local to `chassis_pan`, 0.4 m below where the
 * part actually sits -- the exact mistake that put the first rider on the floor.
 */
function cartBox(name: string): THREE.Box3 {
  const cart = buildGraph(CART_GRAPH);
  cart.root.updateMatrixWorld(true);
  const node = cart.named.get(name);
  if (!node) throw new Error(`cart graph has no node named ${name}`);
  const box = ownBox(node);
  cart.dispose();
  return box;
}

describe("the rider graph", () => {
  it("declares and uses exactly its own four slots, and none of the cart's eight", () => {
    expect(Object.keys(DRIVER_GRAPH.slots).sort()).toEqual(["cap", "shirt", "skin", "trousers"]);

    const used = new Set<string>();
    const walk = (n: { slot: string; children?: readonly unknown[] }): void => {
      used.add(n.slot);
      for (const c of n.children ?? []) walk(c as typeof n);
    };
    walk(DRIVER_GRAPH.root);
    expect([...used].sort()).toEqual(Object.keys(DRIVER_GRAPH.slots).sort());

    // The loadout paints in the cart's vocabulary. A slot name shared with the cart would make a
    // chassis repaint silently recolour the rider's trousers.
    for (const slot of Object.keys(DRIVER_GRAPH.slots)) {
      expect(Object.keys(CART_GRAPH.slots)).not.toContain(slot);
    }
    expect(DRIVER_SLOTS).toHaveLength(4);
  });

  it("carries the parts ASSET_PIPELINE.md section 2.2 asks a mannequin for", () => {
    const driver = build();
    for (const name of [
      "driver_pelvis",
      "driver_torso",
      "driver_head",
      "driver_cap",
      "driver_upperArmL",
      "driver_lowerArmL",
      "driver_upperArmR",
      "driver_lowerArmR",
      "driver_upperLegL",
      "driver_lowerLegL",
      "driver_upperLegR",
      "driver_lowerLegR",
      // The second pass, from driver-mannequin-01.jpg: the "visibly separated joints" section
      // 2.2 has always asked for, plus the neck and fists the first rider did without.
      "driver_neck",
      "driver_shoulderL",
      "driver_shoulderR",
      "driver_elbowL",
      "driver_elbowR",
      "driver_handL",
      "driver_handR",
      "driver_hipL",
      "driver_hipR",
      "driver_kneeL",
      "driver_kneeR",
    ]) {
      expect(driver.named.get(name), name).toBeDefined();
    }
    expect(driver.named.size).toBe(26);
    driver.dispose();
  });

  it("puts each joint where the two limbs it connects actually meet", () => {
    // The joints are derived in Blender from the limb capsules rather than eyeballed, so the
    // check that matters is that they still sit in the gap. A joint ball floating clear of its
    // limbs is the failure mode, and it reads as fine from three-quarters on.
    const driver = build();
    const at = (name: string): THREE.Vector3 =>
      ownBox(driver.named.get(name)!).getCenter(new THREE.Vector3());

    for (const side of ["L", "R"]) {
      const shoulder = at(`driver_shoulder${side}`);
      const elbow = at(`driver_elbow${side}`);
      const hand = at(`driver_hand${side}`);
      const upperArm = ownBox(driver.named.get(`driver_upperArm${side}`)!);
      const lowerArm = ownBox(driver.named.get(`driver_lowerArm${side}`)!);

      // Each joint touches both limbs it joins; the boxes are expanded by nothing, so this is a
      // real overlap test rather than a "somewhere nearby" one.
      expect(upperArm.distanceToPoint(shoulder), `shoulder${side}`).toBeLessThan(0.05);
      expect(upperArm.distanceToPoint(elbow), `elbow${side} to upper arm`).toBeLessThan(0.05);
      expect(lowerArm.distanceToPoint(elbow), `elbow${side} to forearm`).toBeLessThan(0.05);
      expect(lowerArm.distanceToPoint(hand), `hand${side}`).toBeLessThan(0.05);
      // The fist is at the far end of the forearm, not the elbow end.
      expect(hand.distanceTo(elbow)).toBeGreaterThan(0.15);

      const upperLeg = ownBox(driver.named.get(`driver_upperLeg${side}`)!);
      const lowerLeg = ownBox(driver.named.get(`driver_lowerLeg${side}`)!);
      expect(upperLeg.distanceToPoint(at(`driver_hip${side}`)), `hip${side}`).toBeLessThan(0.05);
      expect(upperLeg.distanceToPoint(at(`driver_knee${side}`)), `knee${side} up`).toBeLessThan(0.05);
      expect(lowerLeg.distanceToPoint(at(`driver_knee${side}`)), `knee${side} down`).toBeLessThan(0.05);
    }

    // The neck bridges the torso and the head rather than sitting inside either.
    const neck = ownBox(driver.named.get("driver_neck")!);
    const torso = ownBox(driver.named.get("driver_torso")!);
    const head = ownBox(driver.named.get("driver_head")!);
    expect(neck.min.y).toBeLessThan(torso.max.y);
    expect(neck.max.y).toBeGreaterThan(head.min.y);
    driver.dispose();
  });

  it("keeps the fists on the wheel, which is what the forearms were posed for", () => {
    // The old version of this measured the forearm's forward end and called it the hand. Now
    // there is an actual hand, so measure that -- and it must not have landed somewhere new.
    const driver = build();
    const wheel = cartBox("steer_wheel").getCenter(new THREE.Vector3());
    for (const side of ["L", "R"]) {
      const fist = ownBox(driver.named.get(`driver_hand${side}`)!).getCenter(new THREE.Vector3());
      expect(fist.distanceTo(wheel), `hand${side} to the wheel centre`).toBeLessThan(0.22);
    }
    driver.dispose();
  });
});

describe("the rider sits in the cart he was measured against", () => {
  it("sits ON the seat cushion rather than through it or above it", () => {
    const driver = build();
    const pelvis = driver.named.get("driver_pelvis");
    expect(pelvis).toBeDefined();

    // The load-bearing check, and the one a looser "is he under the roof?" assertion missed
    // entirely: the first rider authored here was 0.4 m low, feet correctly on the floor and
    // backside 0.3 m below the seat, and every other check passed.
    const seatTop = cartBox("seat_base").max.y;
    const hips = ownBox(pelvis!).min.y;
    expect(hips).toBeGreaterThan(seatTop - 0.06);
    expect(hips).toBeLessThan(seatTop + 0.06);
    driver.dispose();
  });

  it("rests his feet on the footwell floor and clears the canopy with his cap", () => {
    const driver = build();
    const box = new THREE.Box3().setFromObject(driver.root);
    const floor = cartBox("chassis_pan").max.y;
    const canopyUnderside = cartBox("canopy").min.y;

    expect(box.min.y).toBeGreaterThan(floor - 0.02);
    expect(box.min.y).toBeLessThan(floor + 0.08);
    // Head near the roof, not merely somewhere below it: a shrunken rider still clears it.
    expect(box.max.y).toBeLessThan(canopyUnderside);
    expect(box.max.y).toBeGreaterThan(canopyUnderside - 0.2);
    driver.dispose();
  });

  it("keeps the footwell his feet stand in clear of the seat pedestal", () => {
    // body_tub used to run forward to z = +0.28, leaving 0.16 m between its top and the seat --
    // no figure folds into that. The rider's shins are what the shortened tub is for.
    const tub = cartBox("body_tub");
    const seatTop = cartBox("seat_base").max.y;
    const floor = cartBox("chassis_pan").max.y;
    expect(seatTop - floor).toBeGreaterThan(0.35);
    expect(tub.max.z).toBeLessThan(0.0);

    const driver = build();
    const shin = ownBox(driver.named.get("driver_lowerLegL")!);
    expect(shin.min.z).toBeGreaterThan(tub.max.z);
    driver.dispose();
  });

  it("sits on the driver's side, which is the cart's left, because the wheel moved there", () => {
    const driver = build();
    const box = new THREE.Box3().setFromObject(driver.root);
    const wheel = cartBox("steer_wheel").getCenter(new THREE.Vector3());

    // Forward is +Z and up is +Y, so forward x left = up puts the vehicle's left at +X. US
    // carts are left-hand drive; the rider has to be on the same side as the wheel he holds.
    expect(wheel.x).toBeGreaterThan(0);
    const centreX = (box.min.x + box.max.x) / 2;
    expect(centreX).toBeGreaterThan(0);
    expect(Math.abs(centreX - wheel.x)).toBeLessThan(0.25);
    driver.dispose();
  });

  it("puts both hands on the wheel rim", () => {
    const driver = build();
    const rim = cartBox("steer_wheel");
    const wheel = rim.getCenter(new THREE.Vector3());

    for (const arm of ["driver_lowerArmL", "driver_lowerArmR"]) {
      const node = driver.named.get(arm);
      expect(node, arm).toBeDefined();
      const forearm = ownBox(node!);
      // The hand is the forward end of the forearm capsule. Measure in 3D, not along z alone:
      // a rider sitting 0.4 m too low has the same z and is nowhere near the wheel.
      const hand = new THREE.Vector3(forearm.getCenter(new THREE.Vector3()).x, forearm.min.y, forearm.max.z);
      expect(hand.distanceTo(wheel), `${arm} to the wheel centre`).toBeLessThan(0.22);
    }
    driver.dispose();
  });
});
