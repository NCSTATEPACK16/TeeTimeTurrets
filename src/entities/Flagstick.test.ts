import type RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { fixedHoleSpec } from "../sim/course";
import { CUP_RADIUS, createTerrain } from "../sim/terrain";
import { PIN_SHAPE } from "../sim/entities/Pin";
import { Sim } from "../sim/world";
import { Flagstick, placeFlagstick } from "./Flagstick";

/**
 * A render-layer test, so it may import three -- the node environment exists to catch a three
 * import into `src/sim/**` or `src/physics/**`, not to ban it here. Nothing below touches WebGL:
 * geometry, matrices and world transforms are plain data until a renderer draws them.
 */

/** World-space bounding box of one named descendant. */
function boxOf(root: THREE.Object3D, name: string): THREE.Box3 {
  const node = root.getObjectByName(name);
  if (!node) throw new Error(`no node named "${name}" (have ${names(root).join(", ")})`);
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(node);
}

function names(root: THREE.Object3D): string[] {
  const out: string[] = [];
  root.traverse((child) => {
    if (child.name !== "") out.push(child.name);
  });
  return out;
}

describe("Flagstick geometry", () => {
  it("stands 2.1 m tall, the height the sim gives the pin", () => {
    // Sized against the cart, not against prop-silhouettes-01.jpg: that sheet scales every prop
    // to its own cell, so a 0.3 m tee marker and a 2.1 m flagstick are drawn the same height.
    // The cart canopy is at 2.05 m and the turret pivot at 2.6 m, which is what makes a pin at
    // roughly canopy height the right read.
    const pin = new Flagstick();
    pin.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(pin);

    expect(box.max.y).toBeCloseTo(PIN_SHAPE.height, 2);
    // The whole thing sits on the ground plane, not below it: the cup ring is the lowest part.
    expect(box.min.y).toBeGreaterThan(-0.01);
    pin.dispose();
  });

  it("puts the pole's base on the group origin, not its centre", () => {
    // The 0.26 m turret defect was exactly this mistake in the other direction: a collider
    // placed by its centre against a mesh anchored at its base. The pole is base-anchored so
    // `placeFlagstick` can hand it the cup position untouched.
    const pin = new Flagstick();
    const pole = boxOf(pin, "pin_pole");

    expect(pole.min.y).toBeCloseTo(0, 3);
    expect(pole.max.y).toBeCloseTo(PIN_SHAPE.height, 3);
    // Concentric with the group origin, so a base offset cannot hide as a lean.
    expect(pole.min.x).toBeCloseTo(-PIN_SHAPE.radius, 3);
    expect(pole.max.x).toBeCloseTo(PIN_SHAPE.radius, 3);
    pin.dispose();
  });

  it("keeps the pole inside the radius the collider will use", () => {
    // Spec §2.1: a pin of radius r keeps a ball's centre r + BALL_RADIUS from the cup centre, so
    // r must stay under 0.40 m or holing out with the pin in becomes impossible. Asserted here
    // as well as in the sim because a fattened *drawn* pole is the tempting way to make the pin
    // read from the tee, and it would be the version no sim test could see.
    const pin = new Flagstick();
    const pole = boxOf(pin, "pin_pole");
    const halfWidth = Math.max(pole.max.x - pole.min.x, pole.max.z - pole.min.z) / 2;

    expect(halfWidth).toBeLessThanOrEqual(PIN_SHAPE.radius + 1e-6);
    expect(PIN_SHAPE.radius).toBeLessThan(0.4);
    pin.dispose();
  });

  it("hangs the pennant from the top third of the pole", () => {
    const pin = new Flagstick();
    const flag = boxOf(pin, "pin_pennant");

    expect(flag.min.y).toBeGreaterThanOrEqual((PIN_SHAPE.height * 2) / 3);
    expect(flag.max.y).toBeLessThanOrEqual(PIN_SHAPE.height + 1e-6);
    // Flies off the pole rather than being wrapped round it.
    expect(flag.max.x - flag.min.x).toBeGreaterThan(PIN_SHAPE.radius * 4);
    pin.dispose();
  });

  it("draws the cup at the radius the sim holes out on", () => {
    // Not a hole in the green -- `ground.ts` is untouched (spec, out of scope). A ring at the
    // sim's own CUP_RADIUS is what makes the arcade-sized cup legible instead of a mystery.
    const pin = new Flagstick();
    const ring = boxOf(pin, "pin_cup_ring");

    expect((ring.max.x - ring.min.x) / 2).toBeCloseTo(CUP_RADIUS, 2);
    expect(ring.max.y).toBeLessThan(0.06);
    pin.dispose();
  });

  it("animates the pennant on a fixed cycle and allocates nothing to do it", () => {
    // No wind system, and this does not add one (spec, out of scope): the displacement is a
    // function of elapsed time alone, so it is deterministic and needs no state.
    const pin = new Flagstick();
    const flag = pin.getObjectByName("pin_pennant") as THREE.Mesh;
    const attribute = flag.geometry.getAttribute("position");

    pin.update(0);
    const rest = Array.from((attribute.array as Float32Array).slice());
    pin.update(0.7);
    const moved = Array.from((attribute.array as Float32Array).slice());
    expect(moved).not.toEqual(rest);

    // Same buffer, not a replacement: the render loop is covered by the no-allocation rule.
    expect(flag.geometry.getAttribute("position")).toBe(attribute);
    // Same time, same pose -- displacement is read from the clock, never accumulated.
    pin.update(0);
    expect(Array.from((attribute.array as Float32Array).slice())).toEqual(rest);
    pin.dispose();
  });

  it("lays the pole down when felled and leaves the cup where it is", () => {
    const pin = new Flagstick();
    const standingRing = boxOf(pin, "pin_cup_ring");

    pin.setFelled(true);
    const felledPole = boxOf(pin, "pin_pole");
    // Down, not hidden: a felled pin is on the green and the player must be able to see it is.
    expect(pin.getObjectByName("pin_pole")!.visible).toBe(true);
    expect(felledPole.max.y).toBeLessThan(0.2);
    expect(felledPole.max.x - felledPole.min.x).toBeGreaterThan(PIN_SHAPE.height * 0.9);
    // The cup does not move when the pin does.
    expect(boxOf(pin, "pin_cup_ring").max.y).toBeCloseTo(standingRing.max.y, 6);

    pin.setFelled(false);
    expect(boxOf(pin, "pin_pole").max.y).toBeCloseTo(PIN_SHAPE.height, 3);
    pin.dispose();
  });

  it("frees every geometry and every material on dispose", () => {
    const pin = new Flagstick();
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    pin.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      geometries.push(mesh.geometry);
      materials.push(mesh.material as THREE.Material);
    });
    expect(geometries.length).toBeGreaterThan(0);

    const disposed = new Set<unknown>();
    for (const resource of [...geometries, ...materials]) {
      const original = resource.dispose.bind(resource);
      resource.dispose = (): void => {
        disposed.add(resource);
        original();
      };
    }

    pin.dispose();
    for (const geometry of geometries) expect(disposed.has(geometry)).toBe(true);
    for (const material of materials) expect(disposed.has(material)).toBe(true);
  });
});

describe("placeFlagstick", () => {
  it("puts the pole's base exactly on the sim's cup, on a hole whose cup is not the origin", () => {
    // Spec criterion 1, and the shape of it matters more than the tolerance. The comparison is
    // between the *drawn* pole's world base and `terrain.cupPosition` itself -- not between the
    // flagstick and a constant, and the cup and the same constant. That pairing is what let a
    // 0.26 m muzzle defect ship behind two green tests.
    const spec = fixedHoleSpec();
    expect([spec.cup.x, spec.cup.z]).toEqual([45, 8]); // or this proves nothing about placement
    const terrain = createTerrain(spec);
    const cup = terrain.cupPosition;

    const pin = new Flagstick();
    placeFlagstick(pin, terrain);
    const pole = boxOf(pin, "pin_pole");

    expect((pole.min.x + pole.max.x) / 2).toBeCloseTo(cup.x, 2);
    expect((pole.min.z + pole.max.z) / 2).toBeCloseTo(cup.z, 2);
    expect(pole.min.y).toBeCloseTo(cup.y, 2);
    pin.dispose();
  });
});

/**
 * Spec criterion 2, the half that has to cross the sim/render seam.
 *
 * The comparison is between the **live Rapier collider** and the **drawn pole's world bounding
 * box** -- not between each of them and `PIN_SHAPE`. Both do read `PIN_SHAPE`, and that is the
 * point: it is the *anchoring* that differs on the two sides, because a Rapier cylinder is
 * centre-anchored and the mesh is base-anchored. Getting that offset wrong on one side is precisely
 * the shape of the 0.26 m muzzle defect, and only a test that puts the two ends next to each other
 * can see it.
 *
 * This lives here rather than in `world.props.test.ts` because it needs three, and `src/sim/**` may
 * not import it.
 */
describe("the pin's collider and the pin's drawn pole", () => {
  it("agree in world space to well inside a centimetre", async () => {
    const sim = await Sim.create(fixedHoleSpec(), { botCount: 0 });
    const collider = (sim as unknown as { pinCollider: RAPIER.Collider | null }).pinCollider;
    expect(collider).not.toBeNull();

    const pin = new Flagstick();
    placeFlagstick(pin, sim.terrain);
    const pole = boxOf(pin, "pin_pole");

    const centre = collider!.translation();
    const half = collider!.halfHeight();
    expect((pole.min.x + pole.max.x) / 2).toBeCloseTo(centre.x, 2);
    expect((pole.min.z + pole.max.z) / 2).toBeCloseTo(centre.z, 2);
    expect(pole.min.y).toBeCloseTo(centre.y - half, 2);
    expect(pole.max.y).toBeCloseTo(centre.y + half, 2);
    // And no wider than what deflects: a pole drawn fatter than its collider is a ball visibly
    // passing through geometry.
    expect((pole.max.x - pole.min.x) / 2).toBeLessThanOrEqual(collider!.radius() + 1e-6);
    pin.dispose();
  });
});
