import RAPIER from "@dimforge/rapier3d-compat";
import { CART_COLLIDER } from "./entities/Cart";
import { CART_GROUPS } from "./collisionGroups";
import { clampToPlayable } from "./courseBarrier";
import type { SouthBoundary } from "./courseBarrier";
import { ZONE_CLAMP_REACH_M, clampToZone } from "./arenaZone";
import type { ArenaZone } from "./arenaZone";
import type { Playfield, PlayfieldHeightfield } from "./playfield";
import type { Vec3 } from "./course";
import type { CartRig } from "./rigs";
import { FIXED_DT } from "./frame";

export const GRAVITY = 9.81;

/**
 * KCC tuning. Slope limits are what stop the cart driving up a wall or sticking to one.
 *
 * The two slope angles are exported because the causeway is designed against them: at a 1.0 m
 * heightfield cell there is no deck width that behaves like a bridge, only shoulders the cart drives
 * up (under the climb limit) or cannot leave (over it). A second copy of 32 in a terrain test would
 * let the crossing and the controller drift apart.
 *
 * The rest are exported for `tools/terrainProbe.ts`, for the same reason: a probe that times
 * `computeColliderMovement` against its own controller settings is timing a different vehicle.
 */
export const CHARACTER_OFFSET = 0.02;
/** The controller's climb limit before any cart has moved; each cart then sets its own (mobility.ts). */
export const CART_MAX_SLOPE_CLIMB_DEG = 45;
export const CART_MIN_SLOPE_SLIDE_DEG = 32;
export const CART_AUTOSTEP_HEIGHT = 0.45;
export const CART_AUTOSTEP_MIN_WIDTH = 0.25;
export const CART_SNAP_TO_GROUND = 0.6;

/** Half the span the cart's grade is measured over: about half a wheelbase. */
const GRADE_HALF_BASE_M = 1.2;

/** The Rapier world with the ground in it, and the one character controller every cart shares. */
export interface PhysicsWorld {
  readonly world: RAPIER.World;
  readonly controller: RAPIER.KinematicCharacterController;
}

/**
 * A fresh world at `FIXED_DT`, with the ground's heightfield collider and the character
 * controller, in that order. Callers add the carts and the ball pool after it.
 */
export function createPhysicsWorld(field: PlayfieldHeightfield): PhysicsWorld {
  const world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
  world.timestep = FIXED_DT;
  addGround(world, field);

  const controller = world.createCharacterController(CHARACTER_OFFSET);
  controller.setUp({ x: 0, y: 1, z: 0 });
  controller.setMaxSlopeClimbAngle((CART_MAX_SLOPE_CLIMB_DEG * Math.PI) / 180);
  controller.setMinSlopeSlideAngle((CART_MIN_SLOPE_SLIDE_DEG * Math.PI) / 180);
  controller.enableAutostep(CART_AUTOSTEP_HEIGHT, CART_AUTOSTEP_MIN_WIDTH, true);
  controller.enableSnapToGround(CART_SNAP_TO_GROUND);
  // A future flag-ball has to be shovable by the cart, and a KCC ignores dynamic bodies unless
  // told otherwise. Nudging a landed ball by driving into it is correct behaviour anyway.
  controller.setApplyImpulsesToDynamicBodies(true);
  return { world, controller };
}

/** Frees what `createPhysicsWorld` made. Rapier's WASM heap is not garbage-collected. */
export function freePhysicsWorld(physics: PhysicsWorld): void {
  physics.world.removeCharacterController(physics.controller);
  physics.world.free();
}

/** The heightfield collider for the ground. */
function addGround(world: RAPIER.World, field: PlayfieldHeightfield): void {
  const groundDesc = RAPIER.ColliderDesc.heightfield(field.rows, field.cols, field.heights, {
    x: field.extentX,
    y: 1,
    z: field.extentZ,
  })
    // The course is a box that is not centred on anything, so the collider goes where its middle is.
    .setTranslation(field.centreX, 0, field.centreZ)
    .setFriction(0.8)
    .setRestitution(0.15);
  world.createCollider(groundDesc);
}

/** The ground's rise over run along `heading` at (x, z), from two samples a wheelbase apart. */
export function gradeAlong(playfield: Playfield, x: number, z: number, heading: number): number {
  const dx = Math.cos(heading) * GRADE_HALF_BASE_M;
  const dz = Math.sin(heading) * GRADE_HALF_BASE_M;
  return (playfield.heightAt(x + dx, z + dz) - playfield.heightAt(x - dx, z - dz)) / (2 * GRADE_HALF_BASE_M);
}

/** Where a cart may be moved to: the ground's box, the road, and the zone's reach. */
export interface CartLimits {
  readonly playfield: Playfield;
  readonly southBoundary: SouthBoundary | null;
  readonly zone: ArenaZone | null;
}

/** Scratch `moveCartBody` writes through, held by the caller so a tick allocates none of it. */
export interface MoveScratch {
  readonly move: Vec3;
  readonly clamp: { x: number; z: number };
}

export function createMoveScratch(): MoveScratch {
  return { move: { x: 0, y: 0, z: 0 }, clamp: { x: 0, z: 0 } };
}

/**
 * A KCC has no gravity and receives no impulses, so both are the world's problem: fall speed
 * is integrated here, and the recoil that shoves the cart arrives already baked into
 * `cart.desiredTranslation` as a velocity term the cart decays itself.
 *
 * `computedMovement()` allocates inside the binding. That is the one unavoidable per-tick
 * allocation in this loop; everything on our side of the call reuses `scratch`.
 */
export function moveCartBody(
  controller: RAPIER.KinematicCharacterController,
  rig: CartRig,
  limits: CartLimits,
  scratch: MoveScratch,
): void {
  rig.fallSpeed -= GRAVITY * FIXED_DT;
  const move = scratch.move;
  move.x = rig.cart.desiredTranslation.x;
  move.y = rig.fallSpeed * FIXED_DT;
  move.z = rig.cart.desiredTranslation.z;

  // Filtered by the capsule's own groups, so the controller does not collide with hulls.
  controller.computeColliderMovement(rig.collider, move, undefined, CART_GROUPS);
  const corrected = controller.computedMovement();

  const p = rig.cart.position;
  const clamp = scratch.clamp;
  // Held inside the ground's own box -- past it there are no heights, so nothing to stand on --
  // and, where there is one, north of the road: the box is axis-aligned and County Home Road is
  // not, so the box alone leaves a wedge of playable ground on the road side. See courseBarrier.ts.
  clampToPlayable(
    limits.playfield.bounds,
    limits.southBoundary,
    CART_COLLIDER.radius,
    p.x + corrected.x,
    p.z + corrected.z,
    clamp,
  );
  // And no further than the reach past the zone's stakes.
  if (limits.zone !== null) {
    clampToZone(limits.zone, clamp.x, clamp.z, ZONE_CLAMP_REACH_M, clamp);
  }
  p.x = clamp.x;
  p.y += corrected.y;
  p.z = clamp.z;

  if (controller.computedGrounded()) rig.fallSpeed = 0;
  rig.body.setNextKinematicTranslation(p);
}
