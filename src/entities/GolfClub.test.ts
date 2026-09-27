import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { GolfClub, SWING, placeCart, swingAngle } from "./GolfClub";
import { CLUB_STATS, ClubType } from "../physics/Ballistics";
import { Cart, CART_COLLIDER, TURRET_GEOMETRY, computeMuzzle } from "../sim/entities/Cart";
import { CART_GRAPH } from "./cartGraph";
import { DRIVER_GRAPH } from "./driverGraph";
import { buildGraph } from "./primitiveGraph";

/**
 * The swing is a render-only animation over a rig the *simulation* owns the ends of:
 * `computeMuzzle` puts a shot at `barrelLength` along the lofted barrel from a pivot at
 * `pivotHeight`. So the one thing these tests exist for is the frame the ball leaves.
 *
 * `swing_yoke` and `swing_arm` sit BELOW `barrel_pitch` precisely so that a swing angle of zero
 * is a no-op on the muzzle. Anything that breaks that -- a rig re-parented above the loft node,
 * a follow-through that has not returned to address by the time the next shot fires -- makes the
 * ball leave from somewhere the player is not looking, and reads as a physics bug.
 */

const BARREL_PITCH = "barrel_pitch";
const HEAD_SLOT = "head_slot";

/** Where the club head sits in the barrel's own frame. At address this must be (0, 0, length). */
function headInBarrelFrame(cart: GolfClub): THREE.Vector3 {
  cart.updateMatrixWorld(true);
  const pitch = cart.getObjectByName(BARREL_PITCH);
  const head = cart.getObjectByName(HEAD_SLOT);
  if (!pitch || !head) throw new Error("cart graph is missing the turret nodes");
  return pitch.worldToLocal(head.getWorldPosition(new THREE.Vector3()));
}

describe("swingAngle", () => {
  const reload = CLUB_STATS[ClubType.Driver].reloadSeconds;

  it("is zero at address, so a cart standing still holds the club down the barrel", () => {
    expect(swingAngle(0, 1, reload, 0)).toBe(0);
  });

  it("winds back further the longer the shot is charged", () => {
    const quarter = swingAngle(0.25, 1, reload, 0.25);
    const full = swingAngle(1, 1, reload, 1);
    expect(quarter).toBeLessThan(0);
    expect(full).toBeLessThan(quarter);
    expect(Math.abs(full)).toBeCloseTo(SWING.backswingRadians, 2);
  });

  it("passes back through exactly zero at impact, whichever club is equipped", () => {
    // The frame the ball leaves. `reload01` is 0 on the release edge and rises; impact is the
    // end of the downswing, and there the club must be back on the barrel axis.
    //
    // Sampled from *inside* the downswing window, not at its boundary. At exactly `impact` the
    // follow-through branch takes over and returns 0 of its own accord -- so a downswing that
    // stopped short of the ball would have been reported as arriving on it.
    for (const club of [ClubType.Putter, ClubType.Iron, ClubType.Driver]) {
      const seconds = CLUB_STATS[club].reloadSeconds;
      const impact = Math.min(SWING.downswingSeconds / seconds, 0.5);
      expect(swingAngle(0, impact * (1 - 1e-9), seconds, 1), `${club} arriving`).toBeCloseTo(0, 6);
      expect(swingAngle(0, impact, seconds, 1), `${club} at impact`).toBeCloseTo(0, 6);
    }
  });

  it("takes the same wall-clock time to swing on every club, not the same fraction of reload", () => {
    // An iron reloads in 1.1 s and a driver in 2.2 s. A fixed fraction would make the driver's
    // swing twice as slow as the iron's, which is backwards: the swing is a swing and the reload
    // is fetching another ball. The putter is left out on purpose: its 0.25 s pistol reload is
    // shorter than a full swing, so its swing is compressed to fit (the `0.5` cap above).
    const iron = CLUB_STATS[ClubType.Iron].reloadSeconds;
    const driver = CLUB_STATS[ClubType.Driver].reloadSeconds;
    const atOneTenthSecond = (s: number): number => swingAngle(0, 0.1 / s, s, 1);
    expect(atOneTenthSecond(iron)).toBeCloseTo(atOneTenthSecond(driver), 2);
  });

  it("finishes the follow-through and returns to address before the reload ends", () => {
    expect(swingAngle(0, 1, reload, 1)).toBe(0);
    // Somewhere in the follow-through window the club is past impact on the far side.
    const impact = SWING.downswingSeconds / reload;
    const midFollow = impact + (SWING.followThroughSeconds / reload) * 0.5;
    expect(swingAngle(0, midFollow, reload, 1)).toBeGreaterThan(0.5);
  });
});

describe("GolfClub poses the exported rig", () => {
  it("lays the club along the barrel's own lofted direction, with no lateral lean", () => {
    // The assertion the swing rig had to be built around, and the one distance alone cannot
    // make: a swing node bolted ABOVE the loft node still measures barrelLength from the pivot,
    // but applies the loft inside a tilted frame -- so the barrel elevates sideways and the ball
    // leaves at an angle to where the club points. Direction is what catches that.
    //
    // Measured from `barrel_pitch`, not from `pivotHeight`. Those are 0.26 m apart on the
    // shipped model, which is a real disagreement with `computeMuzzle` -- the ball originates
    // 0.26 m below the club head the player sees. It predates the swing and closing it means
    // moving a sim constant and re-validating ballistics; see docs/HANDOFF.md.
    for (const club of [ClubType.Putter, ClubType.Iron, ClubType.Driver]) {
      const cart = new GolfClub(club);
      cart.setAimYaw(0);
      cart.setSwing(0, 1);
      cart.updateMatrixWorld(true);

      const pitch = cart.getObjectByName(BARREL_PITCH)!.getWorldPosition(new THREE.Vector3());
      const head = cart.getObjectByName(HEAD_SLOT)!.getWorldPosition(new THREE.Vector3());
      const along = head.sub(pitch);
      const loft = (CLUB_STATS[club].loftDeg * Math.PI) / 180;

      expect(along.length(), `${club} reach`).toBeCloseTo(TURRET_GEOMETRY.barrelLength, 4);
      expect(along.x, `${club} lateral`).toBeCloseTo(0, 5);
      expect(along.z, `${club} forward`).toBeCloseTo(Math.cos(loft) * TURRET_GEOMETRY.barrelLength, 4);
      expect(along.y, `${club} rise`).toBeCloseTo(Math.sin(loft) * TURRET_GEOMETRY.barrelLength, 4);
      cart.dispose();
    }
  });

  it("leaves the muzzle exactly where computeMuzzle says it is, at address", () => {
    const cart = new GolfClub(ClubType.Driver);
    cart.setSwing(0, 1);
    const local = headInBarrelFrame(cart);

    expect(local.x).toBeCloseTo(0, 5);
    expect(local.y).toBeCloseTo(0, 5);
    expect(local.z).toBeCloseTo(TURRET_GEOMETRY.barrelLength, 5);
    cart.dispose();
  });

  it("takes the club right off that axis mid-backswing", () => {
    const cart = new GolfClub(ClubType.Driver);
    cart.setSwing(1, 1);
    const local = headInBarrelFrame(cart);

    // Still barrelLength from the pivot -- a swing is a rotation -- but nowhere near the barrel.
    expect(local.length()).toBeCloseTo(TURRET_GEOMETRY.barrelLength, 4);
    expect(local.z).toBeLessThan(0);
    expect(Math.abs(local.x)).toBeGreaterThan(0.2);
    cart.dispose();
  });

  it("is back on the barrel axis at the impact frame after a full-charge shot", () => {
    const cart = new GolfClub(ClubType.Driver);
    cart.setSwing(1, 1); // charged to the top
    cart.setSwing(0, 0); // released: the ball leaves on this frame
    const impact = SWING.downswingSeconds / CLUB_STATS[ClubType.Driver].reloadSeconds;
    cart.setSwing(0, impact);

    const local = headInBarrelFrame(cart);
    expect(local.z).toBeCloseTo(TURRET_GEOMETRY.barrelLength, 4);
    cart.dispose();
  });
});

describe("the ball leaves from the club head the player is looking at", () => {
  /**
   * The check that did not exist, and the reason a 0.26 m defect shipped with the cart in PR #9.
   *
   * `cartGraph.test.ts` asserted the yaw ring was at `pivotHeight` and that the head was
   * `barrelLength` from `barrel_pitch`. Both were true. Nothing asserted they were the same
   * origin, and they were 0.26 m apart -- so every shot originated a quarter of a metre below the
   * club head on screen. Two green tests, one real bug.
   *
   * So this one compares the two ends directly and in world space: what `computeMuzzle` hands
   * the ballistics, against where `placeCart` and the exported graph put `head_slot`. Nothing in
   * between is asserted, on purpose. It is allowed to be any rig at all as long as those agree.
   */
  function drawnMuzzle(cart: Cart, model: GolfClub): THREE.Vector3 {
    placeCart(model, cart.position, cart.heading, cart.turretYaw);
    model.setClub(cart.equippedClub);
    model.setSwing(0, 1); // at address: the pose the sim's muzzle describes
    model.updateMatrixWorld(true);
    return model.getObjectByName(HEAD_SLOT)!.getWorldPosition(new THREE.Vector3());
  }

  function simMuzzle(cart: Cart): THREE.Vector3 {
    const out = { x: 0, y: 0, z: 0 };
    computeMuzzle(cart, out);
    return new THREE.Vector3(out.x, out.y, out.z);
  }

  /** A cart standing on flat ground at the origin: the capsule centre is one ground offset up. */
  function standingCart(club: ClubType, heading: number, turretOffset: number): Cart {
    const cart = new Cart({
      club,
      heading,
      turretOffset,
      position: { x: 0, y: CART_COLLIDER.groundOffset, z: 0 },
    });
    return cart;
  }

  it("puts the sim's muzzle within 1 cm of the drawn club head, for every club", () => {
    for (const club of [ClubType.Putter, ClubType.Iron, ClubType.Driver]) {
      const cart = standingCart(club, 0, 0);
      const model = new GolfClub(club);
      expect(drawnMuzzle(cart, model).distanceTo(simMuzzle(cart)), `${club}`).toBeLessThan(0.01);
      model.dispose();
    }
  });

  it("still agrees with the turret slewed and the chassis pointing somewhere else", () => {
    // The case a forward pivot offset is added for: once the pivot is off the yaw axis, the
    // muzzle depends on `heading` as well as `turretYaw`, and the two are no longer the same
    // angle. A test at heading 0 and yaw 0 cannot tell those apart.
    const cases = [
      { heading: 0.9, turretOffset: -0.6 },
      { heading: -2.1, turretOffset: 1.3 },
      { heading: 2.6, turretOffset: 0 },
    ];
    for (const { heading, turretOffset } of cases) {
      const cart = standingCart(ClubType.Driver, heading, turretOffset);
      const model = new GolfClub(ClubType.Driver);
      const label = `heading ${heading} offset ${turretOffset}`;
      expect(drawnMuzzle(cart, model).distanceTo(simMuzzle(cart)), label).toBeLessThan(0.01);
      model.dispose();
    }
  });

  it("keeps agreeing when the cart is somewhere other than the origin", () => {
    const cart = new Cart({
      club: ClubType.Iron,
      heading: 0.4,
      turretOffset: 0.25,
      position: { x: -31.5, y: CART_COLLIDER.groundOffset + 4.2, z: 17.75 },
    });
    const model = new GolfClub(ClubType.Iron);
    expect(drawnMuzzle(cart, model).distanceTo(simMuzzle(cart))).toBeLessThan(0.01);
    model.dispose();
  });
});

describe("the club never swings through the cart it is bolted to", () => {
  /**
   * The pivot sits 0.55 m above the canopy with a 1.75 m club on it, so most of the lower half
   * of the swing circle is occupied by the cart. Whether a given backswing/follow-through/plane
   * combination clears the roof and the rider is a geometry question, and a three-quarter
   * screenshot cannot answer it -- the camera looks from the rider's own side, so a club that
   * has swung a metre clear of him still lands on top of him in the picture.
   *
   * **Every club, not just the driver.** The putter addresses at 3 degrees of loft against the
   * driver's 13, so at the same `swing_arm` angle its head is 10 degrees lower and it is the club
   * that reaches the roof first. A driver-only version of this test passes at follow-through
   * values that put the putter through the canopy.
   */
  const CLUBS = [ClubType.Putter, ClubType.Iron, ClubType.Driver];

  /**
   * Daylight demanded between the shaft and anything solid, at the tightest point of the swing.
   *
   * A margin rather than mere non-intersection, for two reasons. The samples below are 25 points
   * on a line, so a shaft that clips a corner between two of them reads as clear; and the shaft
   * has a radius of its own (0.055 at the butt) that a centreline says nothing about. 0.03 is
   * comfortably under the 0.047 the shipped geometry actually achieves, so this fails on a real
   * regression rather than on rounding.
   */
  const CLEARANCE_M = 0.03;

  function clubSamples(cart: GolfClub): THREE.Vector3[] {
    cart.updateMatrixWorld(true);
    const pitch = cart.getObjectByName(BARREL_PITCH)!.getWorldPosition(new THREE.Vector3());
    const head = cart.getObjectByName(HEAD_SLOT)!.getWorldPosition(new THREE.Vector3());
    const out: THREE.Vector3[] = [];
    for (let i = 0; i <= 24; i++) {
      out.push(pitch.clone().lerp(head, i / 24));
    }
    return out;
  }

  /**
   * The canopy and the rider, node by node, from the unmerged graphs. The cart draws them merged,
   * where no single node survives to take a box of; "draws the shape the unmerged graphs draw"
   * below is what makes these boxes the ones on screen. Both graphs hang from the cart's origin,
   * as `GolfClub` hangs them, and every cart here stands at the world origin.
   */
  function solidBoxes(): { name: string; box: THREE.Box3 }[] {
    const cart = buildGraph(CART_GRAPH);
    const rider = buildGraph(DRIVER_GRAPH);
    cart.root.updateMatrixWorld(true);
    rider.root.updateMatrixWorld(true);
    const boxes: { name: string; box: THREE.Box3 }[] = [];
    for (const name of ["canopy", "driver_torso", "driver_head", "driver_cap"]) {
      const node = cart.named.get(name) ?? rider.named.get(name);
      if (!node) continue;
      const mesh = node as THREE.Mesh;
      mesh.geometry.computeBoundingBox();
      boxes.push({ name, box: mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld) });
    }
    cart.dispose();
    rider.dispose();
    return boxes;
  }

  it.each(CLUBS)("keeps the %s out of the canopy and off the rider through the whole swing", (club) => {
    const cart = new GolfClub(club);
    const boxes = solidBoxes();
    expect(boxes.map((b) => b.name)).toContain("canopy");
    expect(boxes.map((b) => b.name)).toContain("driver_head");

    const hits: string[] = [];
    const check = (label: string): void => {
      for (const point of clubSamples(cart)) {
        for (const { name, box } of boxes) {
          const gap = box.distanceToPoint(point); // 0 while the point is inside
          if (gap < CLEARANCE_M) {
            hits.push(`${label}: shaft ${gap.toFixed(3)} m from ${name}`);
          }
        }
      }
    };

    // The backswing, held at every charge the player can release at.
    for (let c = 0; c <= 1.0001; c += 0.05) {
      cart.setSwing(c, 1);
      check(`charge ${c.toFixed(2)}`);
    }
    // Then the whole released swing: downswing, impact, follow-through, back to address.
    cart.setSwing(1, 1);
    for (let r = 0; r <= 1.0001; r += 0.005) {
      cart.setSwing(0, r);
      check(`reload ${r.toFixed(3)}`);
    }

    expect(hits.slice(0, 5)).toEqual([]);
    cart.dispose();
  });
});

describe("the turret housing tips with the swing without carrying the muzzle", () => {
  it("pitches the housing back into the backswing", () => {
    const cart = new GolfClub(ClubType.Driver);
    const housing = cart.getObjectByName("housing_pitch")!;

    cart.setSwing(0, 1);
    expect(housing.rotation.x, "at address").toBeCloseTo(0, 6);

    cart.setSwing(1, 1);
    // Same sign as the club and a fraction of its travel: the housing leans into the backswing,
    // it does not swing with it.
    expect(housing.rotation.x).toBeLessThan(0);
    expect(Math.abs(housing.rotation.x)).toBeCloseTo(SWING.backswingRadians * SWING.housingShare, 4);
    expect(Math.abs(housing.rotation.x)).toBeLessThan(SWING.backswingRadians);
    cart.dispose();
  });

  it("leaves the muzzle exactly where it was, whatever the housing does", () => {
    // The reason `housing_pitch` is allowed to exist. Pose the swing to the top, then move the
    // housing by hand to something absurd: the club head must not notice.
    const cart = new GolfClub(ClubType.Driver);
    cart.setSwing(0, 1);
    cart.updateMatrixWorld(true);
    const before = cart.getObjectByName(HEAD_SLOT)!.getWorldPosition(new THREE.Vector3());

    cart.getObjectByName("housing_pitch")!.rotation.set(1.2, 0.8, -0.4);
    cart.updateMatrixWorld(true);
    const after = cart.getObjectByName(HEAD_SLOT)!.getWorldPosition(new THREE.Vector3());

    expect(after.distanceTo(before)).toBeCloseTo(0, 9);
    cart.dispose();
  });
});

const RIDER_SLOTS = ["cap", "shirt", "skin", "trousers"];

/** Slot names of every mesh drawn, the loaded ball (which has no slot) aside. */
function drawnSlots(root: THREE.Object3D): Set<string> {
  const out = new Set<string>();
  root.traverseVisible((child) => {
    const name = ((child as THREE.Mesh).material as THREE.Material | undefined)?.name;
    if (name) out.add(name);
  });
  return out;
}

describe("the rider", () => {
  it("rides the cart by default and is disposed with it", () => {
    const cart = new GolfClub(ClubType.Driver);
    expect(cart.getObjectByName("driver_pelvis")).toBeDefined();
    expect([...drawnSlots(cart)].filter((slot) => RIDER_SLOTS.includes(slot)).sort()).toEqual(RIDER_SLOTS);
    cart.dispose();
  });

  it("can be left off, for a cart that is scenery rather than someone's", () => {
    const cart = new GolfClub(ClubType.Driver, {}, { rider: false });
    expect(cart.getObjectByName("driver_pelvis")).toBeUndefined();
    cart.dispose();
  });

  it("is not painted by the cart's cosmetics", () => {
    const cart = new GolfClub(ClubType.Driver);
    cart.setSlotColor("chassis", 0xff0000);
    const rider: THREE.MeshStandardMaterial[] = [];
    cart.traverse((child) => {
      const material = (child as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (material && RIDER_SLOTS.includes(material.name)) rider.push(material);
    });
    expect(rider.map((m) => m.name)).toContain("shirt");
    for (const material of rider) expect(material.color.getHex(), material.name).not.toBe(0xff0000);
    cart.dispose();
  });
});

/**
 * `REVAMP-PLAN.md` Stage 3 budgets about 150 draw calls for eight carts. Unmerged, a cart was a
 * mesh per node -- 50 drawn of its 52, 26 for the rider and one for the loaded ball -- so a round
 * of eight drew over six hundred. The cart and rider now draw one mesh per slot per rigid part.
 *
 * What the merge must not cost is the look, in any pose, and the paint: both are asserted here
 * against the unmerged graphs, which are what the gate subjects and the Blender scene describe.
 */
describe("the cart's draw calls", () => {
  const POSED = ["turret_pivot", "barrel_pitch", "swing_arm", "housing_pitch", "head_putter", "head_iron", "head_driver"];

  function visibleMeshes(root: THREE.Object3D): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    root.traverseVisible((child) => {
      if (child instanceof THREE.Mesh) out.push(child);
    });
    return out;
  }

  /** Per slot: vertices drawn, the sum of their world positions and their bounds. */
  function drawing(root: THREE.Object3D): Map<string, { count: number; sum: THREE.Vector3; box: THREE.Box3 }> {
    root.updateMatrixWorld(true);
    const out = new Map<string, { count: number; sum: THREE.Vector3; box: THREE.Box3 }>();
    const v = new THREE.Vector3();
    for (const mesh of visibleMeshes(root)) {
      const slot = (mesh.material as THREE.Material).name;
      if (!slot) continue; // the loaded ball
      const entry = out.get(slot) ?? { count: 0, sum: new THREE.Vector3(), box: new THREE.Box3() };
      const position = mesh.geometry.getAttribute("position");
      for (let i = 0; i < position.count; i++) {
        v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
        entry.sum.add(v);
        entry.box.expandByPoint(v);
      }
      entry.count += position.count;
      out.set(slot, entry);
    }
    return out;
  }

  it("draws a cart, its rider and its loaded ball in at most 18 meshes", () => {
    const cart = new GolfClub(ClubType.Driver);
    cart.setBallLoaded(true);
    const drawn = visibleMeshes(cart).length;
    expect(drawn, `${drawn} meshes; eight carts draw ${drawn * 8}`).toBeLessThanOrEqual(18);
    cart.dispose();
  });

  it.each([ClubType.Putter, ClubType.Iron, ClubType.Driver])(
    "draws the shape the unmerged graphs draw, through the %s's whole swing",
    (club) => {
      const cart = new GolfClub(club);
      const reference = new THREE.Group();
      const graph = buildGraph(CART_GRAPH);
      const rider = buildGraph(DRIVER_GRAPH);
      reference.add(graph.root, rider.root);

      const compare = (label: string): void => {
        // The reference takes the cart's pose node for node: whatever GolfClub wrote, it copies.
        for (const name of POSED) {
          const from = cart.getObjectByName(name)!;
          const to = graph.named.get(name)!;
          to.rotation.copy(from.rotation);
          to.visible = from.visible;
        }
        const got = drawing(cart);
        const want = drawing(reference);
        expect([...got.keys()].sort(), label).toEqual([...want.keys()].sort());
        for (const [slot, w] of want) {
          const g = got.get(slot)!;
          expect(g.count, `${label} ${slot} vertices`).toBe(w.count);
          for (const axis of ["x", "y", "z"] as const) {
            expect(g.sum[axis], `${label} ${slot} sum ${axis}`).toBeCloseTo(w.sum[axis], 3);
            expect(g.box.min[axis], `${label} ${slot} min ${axis}`).toBeCloseTo(w.box.min[axis], 5);
            expect(g.box.max[axis], `${label} ${slot} max ${axis}`).toBeCloseTo(w.box.max[axis], 5);
          }
        }
      };

      cart.setAimYaw(0.8);
      cart.setSwing(0, 1);
      compare("address");
      cart.setSwing(1, 1);
      compare("top of the backswing");
      cart.setSwing(0, 0.12);
      compare("follow-through");
      cart.setAimYaw(-2.2);
      cart.setSwing(0.5, 1);
      compare("half backswing, turret slewed");

      cart.dispose();
      graph.dispose();
      rider.dispose();
    },
  );

  it("shares one set of geometry between every cart", () => {
    // Eight carts are one graph eight times; nothing about their shape differs, only their paint.
    const a = new GolfClub(ClubType.Driver, { chassis: 0xff0000 });
    const b = new GolfClub(ClubType.Iron, { chassis: 0x0000ff });
    const geometries = (cart: GolfClub): Set<THREE.BufferGeometry> => {
      const out = new Set<THREE.BufferGeometry>();
      cart.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh && (mesh.material as THREE.Material).name) out.add(mesh.geometry);
      });
      return out;
    };
    const fromA = geometries(a);
    const fromB = geometries(b);
    expect(fromA.size).toBeGreaterThan(0);
    expect([...fromA].filter((g) => fromB.has(g)).length).toBe(fromA.size);

    // Freed with the last cart, which makes this a leak check for the whole file too: a test above
    // that forgot `dispose()` holds the geometry, and the last assertion here goes red.
    let freed = 0;
    for (const geometry of fromA) geometry.addEventListener("dispose", () => freed++);
    a.dispose();
    expect(freed, "while the other cart still draws them").toBe(0);
    b.dispose();
    expect(freed).toBe(fromA.size);
  });

  it("still paints each cart on its own", () => {
    const a = new GolfClub(ClubType.Driver);
    const b = new GolfClub(ClubType.Driver);
    a.setSlotColor("chassis", 0xff0000);
    const chassisOf = (cart: GolfClub): number[] => {
      const out: number[] = [];
      cart.traverse((child) => {
        const material = (child as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (material?.name === "chassis") out.push(material.color.getHex());
      });
      return out;
    };
    expect(chassisOf(a).length).toBeGreaterThan(0);
    expect(new Set(chassisOf(a))).toEqual(new Set([0xff0000]));
    expect(chassisOf(b)).not.toContain(0xff0000);
    a.dispose();
    b.dispose();
  });
});
