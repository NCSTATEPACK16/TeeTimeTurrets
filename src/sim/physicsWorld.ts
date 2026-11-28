/**
 * The Rapier world a match runs in: building and freeing it, the ground collider, each cart's
 * body and colliders, the one character controller every cart moves through, and the KCC
 * tuning it is set up with.
 *
 * Split out of `world.ts` in Stage 9 (docs/superpowers/specs/2026-11-28-stage-9-refactor-design.md
 * §4): functions over the `Sim`, called by its fixed step in the order they always ran.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import { neutralIntent } from "./intent";
import {
  CART_COLLIDER,
  CART_HULL,
  CART_TUNING,
  Cart,
  TIRE_TUNING,
  TireType,
} from "./entities/Cart";
import { maxClimbRad } from "./mobility";
import { BallPool } from "./entities/BallPool";
import type { StaticShape } from "./clubhouse";
import { CART_GROUPS, HULL_GROUPS } from "./collisionGroups";
import { clampToPlayable } from "./courseBarrier";
import { SURFACES, SurfaceId } from "./surfaces";
import { ZONE_HARD_LIMIT_M } from "./arenaZone";
import { NO_TARGET, createBotMind } from "./bot";
import { mulberry32 } from "./rng";
import { FIXED_DT } from "./tickConstants";
import type { Sim } from "./world";
import type { CartRig } from "./rigs";
import { botStreamSeed, botSkill } from "./rigs";

/**
 * The clubhouse complex into a fresh Rapier world: fixed colliders with no body, like the ground,
 * and the same friction and bounce as the ground, so a ball off a wall behaves like one off the
 * turf. Default collision groups: carts and balls both hit them, and a hull's ball-only filter
 * already keeps it out. Freed with the world (`freePhysics`), which is their removal path.
 */
export function addStaticColliders(world: RAPIER.World, shapes: readonly StaticShape[]): void {
  for (const s of shapes) {
    const desc =
      s.kind === "box" ? RAPIER.ColliderDesc.cuboid(s.hx, s.hy, s.hz) : RAPIER.ColliderDesc.cylinder(s.hy, s.hx);
    desc
      .setTranslation(s.x, s.y, s.z)
      .setRotation({ x: 0, y: Math.sin(s.yaw / 2), z: 0, w: Math.cos(s.yaw / 2) })
      .setFriction(0.8)
      .setRestitution(0.15);
    world.createCollider(desc);
  }
}

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

/**
 * The steepest grade a stock (street-tyred) cart climbs on a fairway, degrees: `mobility.ts`'s
 * `maxClimbRad` for that pair, about 38.7. **Not what the controller uses** -- `moveCartBody` sets the
 * climb limit per cart per tick from its tyre and the ground under it. Exported as the one figure the
 * terrain tests and the probe hold corridors to, since a corridor is fairway.
 */
export const CART_MAX_SLOPE_CLIMB_DEG =
  (maxClimbRad(TIRE_TUNING[TireType.Street], SURFACES[SurfaceId.Fairway].cartSpeedScale, CART_TUNING.accel) * 180) / Math.PI;

export const CART_MIN_SLOPE_SLIDE_DEG = 32;

export const CART_AUTOSTEP_HEIGHT = 0.45;

export const CART_AUTOSTEP_MIN_WIDTH = 0.25;

export const CART_SNAP_TO_GROUND = 0.6;

/**
 * The Rapier world and everything in it: the ground, the character controller, a body per cart
 * and the ball pool, each registered for contact dispatch, and a rig per cart with a fresh bot
 * stream and mind. Every cart must already exist; `placeRig` puts them down afterwards.
 *
 * `create` and `reset` both build through here, in sim order, so a rematch runs in a world
 * with the same handles and no history -- exactly the world the first match had. Teleporting
 * carts around the old world instead leaves its broadphase and contact state behind, and a
 * rematch then drifts from the first match from its very first tick.
 */
export function buildPhysics(sim: Sim): void {
  sim.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
  sim.world.timestep = FIXED_DT;
  buildGround(sim);
  addStaticColliders(sim.world, sim.staticShapes);

  sim.controller = sim.world.createCharacterController(CHARACTER_OFFSET);
  sim.controller.setUp({ x: 0, y: 1, z: 0 });
  sim.controller.setMaxSlopeClimbAngle((CART_MAX_SLOPE_CLIMB_DEG * Math.PI) / 180);
  sim.controller.setMinSlopeSlideAngle((CART_MIN_SLOPE_SLIDE_DEG * Math.PI) / 180);
  sim.controller.enableAutostep(CART_AUTOSTEP_HEIGHT, CART_AUTOSTEP_MIN_WIDTH, true);
  sim.controller.enableSnapToGround(CART_SNAP_TO_GROUND);
  // A future flag-ball has to be shovable by the cart, and a KCC ignores dynamic bodies unless
  // told otherwise. Nudging a landed ball by driving into it is correct behaviour anyway.
  sim.controller.setApplyImpulsesToDynamicBodies(true);

  sim.rigs.length = 0;
  sim.registry.clear();
  addCartRig(sim, sim.cart, null);

  sim.ballPool = new BallPool(sim.world, {
    heightAt: (x, z) => sim.playfield.heightAt(x, z),
    tuningAt: (x, z, out) => sim.playfield.surfaces.tuningAt(x, z, out),
  });
  sim.eventQueue = new RAPIER.EventQueue(true);
  for (const pooled of sim.ballPool.all) {
    sim.registry.registerBall(pooled.body.collider(0).handle, pooled);
  }
  for (let i = 0; i < sim.bots.length; i++) addCartRig(sim, sim.bots[i]!, i);
}

/** Frees what `buildPhysics` made. Rapier's WASM heap is not garbage-collected. */
export function freePhysics(sim: Sim): void {
  sim.world.removeCharacterController(sim.controller);
  sim.eventQueue.free();
  sim.world.free();
}

/**
 * Builds the heightfield collider for the ground. The heights are computed once per `Sim` and
 * kept, so a rematch does not rebuild them.
 */
export function buildGround(sim: Sim): void {
  sim.heightfield ??= sim.playfield.buildHeightfield();
  const field = sim.heightfield;
  const groundDesc = RAPIER.ColliderDesc.heightfield(field.rows, field.cols, field.heights, {
    x: field.extentX,
    y: 1,
    z: field.extentZ,
  })
    // The course is a box that is not centred on anything, so the collider goes where its middle is.
    .setTranslation(field.centreX, 0, field.centreZ)
    .setFriction(0.8)
    .setRestitution(0.15);
  sim.world.createCollider(groundDesc);
}

/**
 * Creates one cart's body and collider, registers it for contact dispatch, and files the rig.
 * Every cart -- the player's and every bot's -- goes through here, so a bot is physically
 * identical to the player rather than a cheaper approximation of one. `placeRig` puts it down.
 *
 * `botIndex` is the cart's place in `bots`, or `null` for the player. It is passed in rather than
 * read off `rigs.length`, which only equals it while the player's rig is the one already filed.
 */
export function addCartRig(sim: Sim, cart: Cart, botIndex: number | null): void {
  const body = sim.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
  const collider = sim.world.createCollider(
    RAPIER.ColliderDesc.capsule(CART_COLLIDER.halfHeight, CART_COLLIDER.radius)
      .setCollisionGroups(CART_GROUPS)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
      // Rapier computes no contacts between two kinematic bodies by default, and every cart
      // here is kinematic -- without sim, cart-vs-cart shunting generates no events at all.
      .setActiveCollisionTypes(
        RAPIER.ActiveCollisionTypes.DEFAULT | RAPIER.ActiveCollisionTypes.KINEMATIC_KINEMATIC,
      ),
    body,
  );
  // Before the push, so it is the index sim rig is about to occupy.
  const index = sim.rigs.length;
  sim.registry.registerCart(collider.handle, cart, index);
  // What a shot hits. Same body, so it moves with the cart for free; ball-only, so the cart
  // drives exactly as it did without it.
  const hull = sim.world.createCollider(
    RAPIER.ColliderDesc.cylinder(CART_HULL.height / 2, CART_HULL.radius)
      .setTranslation(0, CART_HULL.centreOffset, 0)
      .setCollisionGroups(HULL_GROUPS)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    body,
  );
  sim.registry.registerCart(hull.handle, cart, index);
  sim.rigs.push({
    index,
    cart,
    body,
    collider,
    fallSpeed: 0,
    random: botIndex === null ? null : mulberry32(botStreamSeed(sim, botIndex)),
    intentScratch: botIndex === null ? null : neutralIntent(),
    targetIndex: NO_TARGET,
    mind: botIndex === null ? null : createBotMind(botSkill(sim, botIndex)),
  });
}

/**
 * A KCC has no gravity and receives no impulses, so both are sim class's problem: fall speed
 * is integrated here, and the recoil that shoves the cart arrives already baked into
 * `cart.desiredTranslation` as a velocity term the cart decays itself.
 *
 * `computedMovement()` allocates inside the binding. That is the one unavoidable per-tick
 * allocation in sim loop; everything on our side of the call reuses `moveScratch`.
 */
export function moveCartBody(sim: Sim, rig: CartRig): void {
  rig.fallSpeed -= GRAVITY * FIXED_DT;
  sim.moveScratch.x = rig.cart.desiredTranslation.x;
  sim.moveScratch.y = rig.fallSpeed * FIXED_DT;
  sim.moveScratch.z = rig.cart.desiredTranslation.z;

  // The climb limit is sim cart's, on sim ground: its tyre's grip on the surface under it
  // (`mobility.ts`), which `stepRig` sampled into `cartTuningScratch` sim tick. One controller
  // serves every cart, so it is set before each one moves.
  sim.controller.setMaxSlopeClimbAngle(
    maxClimbRad(TIRE_TUNING[rig.cart.tire], sim.cartTuningScratch.cartSpeedScale, CART_TUNING.accel),
  );
  // Filtered by the capsule's own groups, so the controller does not collide with hulls.
  sim.controller.computeColliderMovement(rig.collider, sim.moveScratch, undefined, CART_GROUPS);
  const corrected = sim.controller.computedMovement();

  const p = rig.cart.position;
  // Held inside the ground's own box -- past it there are no heights, so nothing to stand on --
  // and, where there is one, north of the road: the box is axis-aligned and County Home Road is
  // not, so the box alone leaves a wedge of playable ground on the road side. See courseBarrier.ts.
  let nextX = p.x + corrected.x;
  let nextZ = p.z + corrected.z;
  // No further than `ZONE_HARD_LIMIT_M` out of the zone. Before the box and the road, so they
  // still have the last word.
  if (sim.zone !== null && sim.zone.clampWithin(nextX, nextZ, ZONE_HARD_LIMIT_M, sim.zoneScratch)) {
    nextX = sim.zoneScratch.x;
    nextZ = sim.zoneScratch.z;
  }
  clampToPlayable(
    sim.playfield.bounds,
    sim.southBoundary,
    CART_COLLIDER.radius,
    nextX,
    nextZ,
    sim.clampScratch,
  );
  p.x = sim.clampScratch.x;
  p.y += corrected.y;
  p.z = sim.clampScratch.z;

  if (sim.controller.computedGrounded()) rig.fallSpeed = 0;
  rig.body.setNextKinematicTranslation(p);
}
