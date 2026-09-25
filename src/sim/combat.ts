import { applyDamage } from "./health";
import type { Cart } from "./entities/Cart";
import type { PooledBall } from "./entities/BallPool";

/**
 * The combat orchestrator: the only module in the project that reads Rapier collision events.
 *
 * It sits alongside world.ts rather than inside it, following the leaf-module split the ammo
 * system established (BallPool.ts / Pickup.ts): world.ts imports this, this imports nothing from
 * world.ts, and the damage rules stay testable without a Sim.
 *
 * Every existing proximity check in this codebase (isGrounded, ballsNear) is polling; this is
 * deliberately not. A ball crossing a target at 40 m/s covers 0.67 m per tick,
 * so a radius check either misses it or has to be wide enough to register hits that visibly
 * missed. Real contact events do not have that failure.
 *
 * See docs/superpowers/specs/2026-09-02-targets-health-combat-design.md §4.
 */

/** One ball hit is one point of health. A bar is `ARENA_MAX_HEALTH` points tall. */
export const STROKE_DAMAGE = 1;

/** Two carts at CART_TUNING.topSpeed head-on close at ~28 m/s: 22 damage. Ramming hurts, but
 * shooting stays the primary way to kill something. */
export const SHUNT_DAMAGE_PER_MPS = 0.8;
/** Below this, contact between two carts is parking, not ramming: no damage and no shove. */
export const SHUNT_MIN_SPEED = 3;
/** Fraction of the closing speed each cart carries away from a shunt as `shuntVelocity`. */
export const SHUNT_VELOCITY_TRANSFER = 0.5;

/** What a collider handle turns out to belong to: a fired ball, or a cart. */
export type Actor = { kind: "ball"; ball: PooledBall } | { kind: "cart"; cart: Cart; index: number };

/**
 * Collider handle -> entity. A drained collision event carries two integer handles and nothing
 * else, so this lookup is the whole reason the spec's `{ targets, carts, stats }` context could
 * not work as written -- see the implementation plan's stated departures.
 */
export class CombatRegistry {
  private readonly actors = new Map<number, Actor>();

  /** The pooled ball itself, not just its body: `firedBy` is what a kill is attributed to. */
  registerBall(handle: number, ball: PooledBall): void {
    this.actors.set(handle, { kind: "ball", ball });
  }

  /** `index` is the cart's index in `Sim.rigs` -- the same index the scoreboard, the bot
   *  array and the nameplates all use, so no second identity has to be mapped to it. */
  registerCart(handle: number, cart: Cart, index: number): void {
    this.actors.set(handle, { kind: "cart", cart, index });
  }

  get(handle: number): Actor | undefined {
    return this.actors.get(handle);
  }
}

/** The slice of RAPIER.EventQueue this module uses -- narrow so tests can script contacts. */
export interface CollisionEventSource {
  drainCollisionEvents(f: (handle1: number, handle2: number, started: boolean) => void): void;
}

export interface CombatContext {
  registry: CombatRegistry;
  /**
   * A fired ball connected with something. `shooter` is the rig that fired it; `x`/`y`/`z` are the
   * ball's position at impact, which is where a hit marker floats.
   *
   * This replaces `ctx.stats.directHits += 1` written inline here, and the move is the fix for
   * `docs/TEST-AND-SPEC-PITFALLS.md` §4: `Stats` is the **player's**, and crediting it from a
   * module that could not tell whose ball it was meant a bot's hit inflated the player's
   * accuracy. `world.ts` now decides, and it decides by asking whether `shooter` is rig 0.
   */
  onBallHit: (shooter: number, x: number, y: number, z: number) => void;
  /**
   * Called once, on the contact that takes a cart from above zero HP to zero.
   *
   * `victim` and `killer` are rig indices; `killer` is `NO_KILLER` for a death nobody caused.
   * Both are passed rather than looked up, because a `rigs.indexOf` at the point of a kill would
   * be a second way of answering a question the registry already answered.
   */
  onCartKilled: (cart: Cart, victim: number, killer: number) => void;
}

/**
 * World-space velocity of a cart, reconstructed from the state the cart owns rather than read off
 * its rigid body: the body is kinematic, so its "velocity" is whatever translation the character
 * controller last resolved, which is not the cart's intent. This is the same set of terms
 * Cart.step folds into desiredTranslation.
 */
function cartVelocity(cart: Cart, out: { x: number; z: number }): void {
  out.x = Math.cos(cart.heading) * cart.speed + cart.recoil.x + cart.shuntVelocity.x;
  out.z = Math.sin(cart.heading) * cart.speed + cart.recoil.z + cart.shuntVelocity.z;
}

// Per-tick scratch, reused across contacts, per the AGENTS.md no-allocation-in-the-hot-loop rule.
const velA = { x: 0, z: 0 };
const velB = { x: 0, z: 0 };

/**
 * Drains one tick's collision events and resolves each independently -- no cross-contact state,
 * matching how BallPool.step already treats each pooled ball.
 */
export function processContacts(queue: CollisionEventSource, ctx: CombatContext): void {
  queue.drainCollisionEvents((handle1, handle2, started) => {
    if (!started) return;
    const a = ctx.registry.get(handle1);
    const b = ctx.registry.get(handle2);
    if (!a || !b) return;

    if (a.kind === "ball" && b.kind === "cart") return ballHitsCart(a.ball, b, ctx);
    if (b.kind === "ball" && a.kind === "cart") return ballHitsCart(b.ball, a, ctx);
    if (a.kind === "cart" && b.kind === "cart") return cartsShunt(a, b, ctx);
  });
}

function ballHitsCart(ball: PooledBall, victim: { cart: Cart; index: number }, ctx: CombatContext): void {
  const cart = victim.cart;
  // A cart awaiting respawn is out of the world: it takes no damage, no stroke, and generates
  // no accuracy credit for whoever shot at it. `world.ts` freezes it for the same reason.
  if (cart.dead) return;
  // Spawn protection reads exactly like death here, and for the same reason: the cart is not a
  // valid thing to have hit, so the shot earns nothing either. Ramming is deliberately not
  // guarded -- a cart that cannot be shot and cannot be pushed can park inside an enemy.
  if (cart.protectedFor > 0) return;

  const at = ball.body.translation();
  ctx.onBallHit(ball.firedBy, at.x, at.y, at.z);
  if (applyDamage(cart.health, STROKE_DAMAGE)) ctx.onCartKilled(cart, victim.index, ball.firedBy);
}

/**
 * Both carts take damage and both are shoved apart. The shove is added to `shuntVelocity`, which
 * Cart decays exactly like recoil -- never an impulse, because a KinematicCharacterController
 * receives none (docs/DECISIONS.md, physics ownership).
 *
 * Not counted in `directHits`: that stat feeds shot accuracy, and ramming is not a shot.
 *
 * A ram kill is attributed to the **other** cart -- a ram is something one cart did to another,
 * which is what a kill is. Both dying in one contact scores both, each against the other; that is
 * two deaths and two kills, and pretending it is anything else would need a rule nobody has asked
 * for.
 */
function cartsShunt(
  first: { cart: Cart; index: number },
  second: { cart: Cart; index: number },
  ctx: CombatContext,
): void {
  const a = first.cart;
  const b = second.cart;
  cartVelocity(a, velA);
  cartVelocity(b, velB);
  const closing = Math.hypot(velA.x - velB.x, velA.z - velB.z);
  if (closing < SHUNT_MIN_SPEED) return;

  // A ram can kill, and it takes the same stroke penalty a shot does -- death has one path.
  const damage = closing * SHUNT_DAMAGE_PER_MPS;
  if (applyDamage(a.health, damage)) ctx.onCartKilled(a, first.index, second.index);
  if (applyDamage(b.health, damage)) ctx.onCartKilled(b, second.index, first.index);

  // Along the line between them, so the pair separates rather than being flung sideways. Two
  // carts exactly co-located (only reachable synthetically) fall back to the closing direction.
  let dx = a.position.x - b.position.x;
  let dz = a.position.z - b.position.z;
  let length = Math.hypot(dx, dz);
  if (length < 1e-6) {
    dx = velA.x - velB.x;
    dz = velA.z - velB.z;
    length = closing;
  }

  const push = (closing * SHUNT_VELOCITY_TRANSFER) / length;
  a.shuntVelocity.x += dx * push;
  a.shuntVelocity.z += dz * push;
  b.shuntVelocity.x -= dx * push;
  b.shuntVelocity.z -= dz * push;
}
