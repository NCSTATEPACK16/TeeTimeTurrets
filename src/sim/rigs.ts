import RAPIER from "@dimforge/rapier3d-compat";
import { neutralIntent } from "./intent";
import type { PlayerIntent } from "./intent";
import { CART_COLLIDER, CART_HULL } from "./entities/Cart";
import type { Cart } from "./entities/Cart";
import type { CombatRegistry } from "./combat";
import { CART_GROUPS, HULL_GROUPS } from "./collisionGroups";
import { createNavRoute } from "./navGraph";
import type { NavRoute } from "./navGraph";
import { BOT_CHANNEL, BOT_SKILL_CHANNEL, NO_TARGET, createBotMind } from "./bot";
import type { BotMind } from "./bot";
import type { SpawnPoint } from "./spawn";
import { hashChannel, mulberry32 } from "./rng";

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
  /** The bot's route to its target across the zone, or `null` with no graph or for the player. */
  readonly route: NavRoute | null;
}

/**
 * Bot `i`'s seeded stream. The `0` is the slot a hole index occupied when arena was built on top
 * of a hole-1 `Sim`; it stays so a recorded match replays unchanged.
 */
export function botStreamSeed(seed: number, botIndex: number): number {
  return hashChannel(seed, 0, BOT_CHANNEL, botIndex);
}

/**
 * Bot `i`'s skill, 0..1: the first draw of its own `BOT_SKILL_CHANNEL` stream, so it is fixed
 * per seed and giving bots a skill moves none of their `BOT_CHANNEL` draws.
 */
export function botSkill(seed: number, botIndex: number): number {
  return mulberry32(hashChannel(seed, 0, BOT_SKILL_CHANNEL, botIndex))();
}

/**
 * Creates one cart's body and collider, registers it for contact dispatch, and files the rig in
 * `rigs`. Every cart -- the player's and every bot's -- goes through here, so a bot is physically
 * identical to the player rather than a cheaper approximation of one. `placeRig` puts it down.
 *
 * `bot` is the match seed and the cart's place in `bots`, or `null` for the player. The index is
 * passed in rather than read off `rigs.length`, which only equals it while the player's rig is the
 * one already filed. `routed` gives a bot a nav route, on a ground that has a graph.
 */
export function addCartRig(
  world: RAPIER.World,
  registry: CombatRegistry,
  rigs: CartRig[],
  cart: Cart,
  bot: { readonly seed: number; readonly index: number } | null,
  routed: boolean,
): void {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
  const collider = world.createCollider(
    RAPIER.ColliderDesc.capsule(CART_COLLIDER.halfHeight, CART_COLLIDER.radius)
      .setCollisionGroups(CART_GROUPS)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
      // Rapier computes no contacts between two kinematic bodies by default, and every cart
      // here is kinematic -- without this, cart-vs-cart shunting generates no events at all.
      .setActiveCollisionTypes(
        RAPIER.ActiveCollisionTypes.DEFAULT | RAPIER.ActiveCollisionTypes.KINEMATIC_KINEMATIC,
      ),
    body,
  );
  // Before the push, so it is the index this rig is about to occupy.
  const index = rigs.length;
  registry.registerCart(collider.handle, cart, index);
  // What a shot hits. Same body, so it moves with the cart for free; ball-only, so the cart
  // drives exactly as it did without it.
  const hull = world.createCollider(
    RAPIER.ColliderDesc.cylinder(CART_HULL.height / 2, CART_HULL.radius)
      .setTranslation(0, CART_HULL.centreOffset, 0)
      .setCollisionGroups(HULL_GROUPS)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    body,
  );
  registry.registerCart(hull.handle, cart, index);
  rigs.push({
    index,
    cart,
    body,
    collider,
    fallSpeed: 0,
    random: bot === null ? null : mulberry32(botStreamSeed(bot.seed, bot.index)),
    intentScratch: bot === null ? null : neutralIntent(),
    targetIndex: NO_TARGET,
    mind: bot === null ? null : createBotMind(botSkill(bot.seed, bot.index)),
    route: bot === null || !routed ? null : createNavRoute(),
  });
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
