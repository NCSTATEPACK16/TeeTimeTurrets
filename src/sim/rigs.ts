/**
 * A cart rig -- everything the world owns for one cart -- and the small pieces around it: its
 * bot stream and skill, placing it on a spawn point, the list of carts in rig order, the ground's
 * grade under it, and the transforms the renderer interpolates between.
 *
 * Split out of `world.ts` in Stage 9 (docs/superpowers/specs/2026-11-28-stage-9-refactor-design.md
 * §4): functions over the `Sim`, called by its fixed step in the order they always ran.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import type { PlayerIntent } from "./intent";
import { CART_COLLIDER, Cart } from "./entities/Cart";
import type { Vec3 } from "./course";
import { BOT_CHANNEL, BOT_SKILL_CHANNEL } from "./bot";
import type { BotMind } from "./bot";
import type { SpawnPoint } from "./spawn";
import { hashChannel, mulberry32 } from "./rng";
import type { Sim } from "./world";

/** Half the baseline the downhill grade is read over: about the cart's own wheelbase. */
export const GRADE_SPAN_M = 1.2;

export interface CartTransform {
  position: Vec3;
  /** Chassis yaw, radians. */
  heading: number;
  /** Turret yaw, radians, absolute in world space. */
  turretYaw: number;
}

/**
 * Everything the world owns for one cart: the state machine, the kinematic body it drives, the
 * collider that generates its contacts, and the fall speed the KCC does not integrate for us.
 *
 * Bundled rather than kept as parallel arrays because every one of these is looked up together,
 * every time. Rig 0 is always the player's; the rest are bots, in `bots` order.
 */
export interface CartRig {
  /**
   * Its own position in `Sim.rigs`. 0 is always the player's. It is the identity of a player
   * everywhere in the project -- `bots[i - 1]`, the nameplates and the scoreboard all index by it.
   */
  readonly index: number;
  readonly cart: Cart;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  fallSpeed: number;
  /**
   * The bot's own seeded stream. `null` for the player's rig, which is not AI-driven.
   * Deliberately not `readonly`: `reset()` re-seeds it so "play again" is a genuine rerun.
   */
  random: (() => number) | null;
  /** Reused per tick so the bot's intent costs no allocation. `null` for the player's rig. */
  readonly intentScratch: PlayerIntent | null;
  /** The rig this bot is fighting, per `pickTarget`, or `NO_TARGET`. Unused by the player's rig. */
  targetIndex: number;
  /**
   * What the bot remembers between ticks (`sim/bot.ts`): its skill, its progress tracking and the
   * ammo it is heading for. `null` for the player's rig. Written in place every tick.
   */
  readonly mind: BotMind | null;
}

export function createCartTransform(): CartTransform {
  return { position: { x: 0, y: 0, z: 0 }, heading: 0, turretYaw: 0 };
}

export function writeCartTransform(cart: Cart, out: CartTransform): void {
  const p = cart.position;
  out.position.x = p.x;
  out.position.y = p.y;
  out.position.z = p.z;
  out.heading = cart.heading;
  out.turretYaw = cart.turretYaw;
}

export function copyCartTransform(from: CartTransform, to: CartTransform): void {
  to.position.x = from.position.x;
  to.position.y = from.position.y;
  to.position.z = from.position.z;
  to.heading = from.heading;
  to.turretYaw = from.turretYaw;
}

/**
 * Bot `i`'s seeded stream. The `0` is the slot a hole index occupied when arena was built on top
 * of a hole-1 `Sim`; it stays so a recorded match replays unchanged.
 */
export function botStreamSeed(sim: Sim, botIndex: number): number {
  return hashChannel(sim.seed, 0, BOT_CHANNEL, botIndex);
}

/**
 * Bot `i`'s skill, 0..1: the first draw of its own `BOT_SKILL_CHANNEL` stream, so it is fixed
 * per seed and giving bots a skill moves none of their `BOT_CHANNEL` draws.
 */
export function botSkill(sim: Sim, botIndex: number): number {
  return mulberry32(hashChannel(sim.seed, 0, BOT_SKILL_CHANNEL, botIndex))();
}

/** One cart onto one spawn point: position, facing, momentum and the body, in that order. */
export function placeRig(rig: CartRig, spawn: SpawnPoint): void {
  const cart = rig.cart;
  cart.position.x = spawn.x;
  cart.position.y = spawn.y + CART_COLLIDER.groundOffset;
  cart.position.z = spawn.z;
  cart.heading = spawn.heading;
  cart.turretOffset = 0;
  // The drop point after a hazard is where it now stands, not wherever it drowned.
  cart.lastSafePosition.x = cart.position.x;
  cart.lastSafePosition.y = cart.position.y;
  cart.lastSafePosition.z = cart.position.z;
  cart.wasInWater = false;
  rig.fallSpeed = 0;
  rig.body.setTranslation(cart.position, true);
}

/**
 * Every cart in rig order, for the spawn module's clearance check. Rebuilt lazily and cached:
 * `respawnPoint` wants an indexable list, but a `map` per respawn would allocate inside a tick.
 */
export function cartsOf(sim: Sim): readonly Cart[] {
  if (sim.cartsScratch.length !== sim.rigs.length) {
    sim.cartsScratch.length = 0;
    for (const rig of sim.rigs) sim.cartsScratch.push(rig.cart);
  }
  return sim.cartsScratch;
}

/**
 * The ground's slope along a heading at a point, rise over run, positive uphill: a central
 * difference across `GRADE_SPAN_M` either side, for the cart's downhill bonus.
 */
export function gradeAlong(sim: Sim, x: number, z: number, heading: number): number {
  const dx = Math.cos(heading) * GRADE_SPAN_M;
  const dz = Math.sin(heading) * GRADE_SPAN_M;
  const ahead = sim.playfield.heightAt(x + dx, z + dz);
  const behind = sim.playfield.heightAt(x - dx, z - dz);
  return (ahead - behind) / (2 * GRADE_SPAN_M);
}
