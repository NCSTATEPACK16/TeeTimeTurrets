import RAPIER from "@dimforge/rapier3d-compat";
import { describe, expect, it } from "vitest";
import { AUTHORED_CLUBHOUSE, metresNorthOfBoundary } from "./authoredLayout";
import { KIT_FOOTPRINTS, KIT_SHAPES, clubhouseShapes, type CollidingPiece } from "./clubhouse";
import { LOT_PLACEMENT, placedAt } from "./clubhouseLayout";
import { CART_COLLIDER } from "./entities/Cart";
import { CART_GROUPS } from "./collisionGroups";
import { addStaticColliders } from "./world";

/** Smoke check for the clubhouse colliders (`docs/art/specs/sim-slices.md` §1). */
describe("clubhouse colliders", () => {
  it("each piece's collider union covers its measured footprint to within 0.1 m", () => {
    for (const piece of Object.keys(KIT_SHAPES) as CollidingPiece[]) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const s of KIT_SHAPES[piece]) {
        const [x0, x1, z0, z1] =
          s.kind === "box" ? [s.minX, s.maxX, s.minZ, s.maxZ] : [s.x - s.radius, s.x + s.radius, s.z - s.radius, s.z + s.radius];
        minX = Math.min(minX, x0);
        maxX = Math.max(maxX, x1);
        minZ = Math.min(minZ, z0);
        maxZ = Math.max(maxZ, z1);
      }
      const fp = KIT_FOOTPRINTS[piece];
      expect(Math.abs(minX - fp.minX), `${piece} minX`).toBeLessThanOrEqual(0.1);
      expect(Math.abs(maxX - fp.maxX), `${piece} maxX`).toBeLessThanOrEqual(0.1);
      expect(Math.abs(minZ - fp.minZ), `${piece} minZ`).toBeLessThanOrEqual(0.1);
      expect(Math.abs(maxZ - fp.maxZ), `${piece} maxZ`).toBeLessThanOrEqual(0.1);
    }
  });

  it("stops a cart's character controller at the clubhouse wall", async () => {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    // On flat ground at the origin, the verandah's west face is at x = -12.
    addStaticColliders(world, clubhouseShapes({ x: 0, z: 0 }, () => 0));
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(-20, CART_COLLIDER.groundOffset, 0),
    );
    const capsule = world.createCollider(
      RAPIER.ColliderDesc.capsule(CART_COLLIDER.halfHeight, CART_COLLIDER.radius).setCollisionGroups(CART_GROUPS),
      body,
    );
    const controller = world.createCharacterController(0.02);
    world.step();

    // 60 ticks at 12 m/s is 12 m: through the 8 m gap and far into the building, were it not there.
    const p = { x: -20, y: CART_COLLIDER.groundOffset, z: 0 };
    for (let tick = 0; tick < 60; tick++) {
      controller.computeColliderMovement(capsule, { x: 12 / 60, y: 0, z: 0 }, undefined, CART_GROUPS);
      const m = controller.computedMovement();
      p.x += m.x;
      p.z += m.z;
      body.setNextKinematicTranslation(p);
      world.step();
    }
    expect(p.x).toBeGreaterThan(-12 - CART_COLLIDER.radius - 0.2);
    expect(p.x).toBeLessThan(-12 - CART_COLLIDER.radius + 0.05);
    world.free();
  });

  it("puts every lot corner at least 5 m north of the road", () => {
    const lot = placedAt(AUTHORED_CLUBHOUSE, LOT_PLACEMENT);
    for (const [dx, dz] of [
      [-10.5, -3],
      [10.5, -3],
      [-10.5, 3],
      [10.5, 3],
    ] as const) {
      expect(metresNorthOfBoundary(lot.x + dx, lot.z + dz)).toBeGreaterThanOrEqual(5);
    }
  });
});
