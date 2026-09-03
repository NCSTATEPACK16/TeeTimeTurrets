import type RAPIER from "@dimforge/rapier3d-compat";
import { applyDamage } from "./health";
import type { Cart } from "./entities/Cart";
import type { Target, TargetPart } from "./entities/Target";
import type { Stats } from "./stats";

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

/**
 * Damage tuning, derived from the ball speeds Ballistics.CLUB_STATS can actually produce
 * (putter minimum 2 m/s to driver maximum 40 m/s) against Cart's STARTING_HP of 100:
 *
 * - A full-charge driver lands on the MAX clamp, so two clean hits kill. A one-shot kill would
 *   make the respawn loop the whole game.
 * - A putter tap lands on the MIN clamp, so a weak hit still registers rather than reading as a
 *   miss the player cannot distinguish from one.
 * - A mid-charge iron (~16 m/s) does 24, which is the shape the curve exists for: charge and
 *   club choice both matter, neither is decisive on its own.
 */
export const DAMAGE_PER_MPS = 1.5;
export const MIN_HIT_DAMAGE = 5;
export const MAX_HIT_DAMAGE = 60;

/**
 * Cart-only mode's whole damage rule: one ball hit is one stroke and one point of health, and a
 * health bar is 2 x par points tall. Speed no longer scales damage -- a stroke is a stroke, and
 * making a driver hit worth more strokes than a putter hit would be scoring the club rather than
 * the shot.
 *
 * DAMAGE_PER_MPS / MIN_HIT_DAMAGE / MAX_HIT_DAMAGE and `hitDamage` above are kept, unreferenced
 * by the live path, as the reference curve for a future mode that wants graduated damage back --
 * the same dormant-code exception the design spec makes for the stationary swing.
 */
export const STROKE_DAMAGE = 1;

/** Two carts at CART_TUNING.topSpeed head-on close at ~28 m/s: 22 damage. Ramming hurts, but
 * shooting stays the primary way to kill something. */
export const SHUNT_DAMAGE_PER_MPS = 0.8;
/** Below this, contact between two carts is parking, not ramming: no damage and no shove. */
export const SHUNT_MIN_SPEED = 3;
/** Fraction of the closing speed each cart carries away from a shunt as `shuntVelocity`. */
export const SHUNT_VELOCITY_TRANSFER = 0.5;

/**
 * Impulse per m/s of ball impact speed, applied to the struck ragdoll part. Scripted rather than
 * left to the solver because the contact that produced the event was resolved against a *Fixed*
 * body on that tick -- the flip to Dynamic necessarily happens after it. docs/DECISIONS.md
 * "Ball mass" names this exact approach as the controllable path, and Target's own velocity
 * clamp bounds whatever this asks for.
 */
export const KNOCKDOWN_IMPULSE_PER_MPS = 12;

/** What a collider handle turns out to belong to. */
export type Actor =
  | { kind: "ball"; body: RAPIER.RigidBody }
  | { kind: "targetPart"; target: Target; part: TargetPart }
  | { kind: "cart"; cart: Cart };

/**
 * Collider handle -> entity. A drained collision event carries two integer handles and nothing
 * else, so this lookup is the whole reason the spec's `{ targets, carts, stats }` context could
 * not work as written -- see the implementation plan's stated departures.
 */
export class CombatRegistry {
  private readonly actors = new Map<number, Actor>();

  registerBall(handle: number, body: RAPIER.RigidBody): void {
    this.actors.set(handle, { kind: "ball", body });
  }

  registerCart(handle: number, cart: Cart): void {
    this.actors.set(handle, { kind: "cart", cart });
  }

  registerTarget(target: Target): void {
    for (const part of target.parts) {
      this.actors.set(part.collider.handle, { kind: "targetPart", target, part });
    }
  }

  unregisterTarget(target: Target): void {
    for (const part of target.parts) this.actors.delete(part.collider.handle);
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
  stats: Stats;
  /** Called once, on the contact that takes a cart from above zero HP to zero. */
  onCartKilled: (cart: Cart) => void;
}

/** Damage for a ball landing at `speed` m/s relative to what it hit. */
export function hitDamage(speed: number): number {
  return Math.min(MAX_HIT_DAMAGE, Math.max(MIN_HIT_DAMAGE, speed * DAMAGE_PER_MPS));
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
const impulseScratch = { x: 0, y: 0, z: 0 };

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

    if (a.kind === "ball" && b.kind === "targetPart") return ballHitsTarget(a.body, b, ctx);
    if (b.kind === "ball" && a.kind === "targetPart") return ballHitsTarget(b.body, a, ctx);
    if (a.kind === "ball" && b.kind === "cart") return ballHitsCart(a.body, b.cart, ctx);
    if (b.kind === "ball" && a.kind === "cart") return ballHitsCart(b.body, a.cart, ctx);
    if (a.kind === "cart" && b.kind === "cart") return cartsShunt(a.cart, b.cart, ctx);
  });
}

function ballHitsTarget(
  ball: RAPIER.RigidBody,
  hit: { target: Target; part: TargetPart },
  ctx: CombatContext,
): void {
  const wasDown = hit.target.isDown;
  const v = ball.linvel();
  const speed = Math.hypot(v.x, v.y, v.z);
  const scale = speed < 1e-6 ? 0 : KNOCKDOWN_IMPULSE_PER_MPS;

  impulseScratch.x = v.x * scale;
  impulseScratch.y = v.y * scale;
  impulseScratch.z = v.z * scale;
  hit.target.knockDown(hit.part, impulseScratch);

  ctx.stats.directHits += 1;
  if (!wasDown) ctx.stats.targetsDown += 1;
}

function ballHitsCart(_ball: RAPIER.RigidBody, cart: Cart, ctx: CombatContext): void {
  // A cart awaiting respawn is out of the world: it takes no damage, no stroke, and generates
  // no accuracy credit for whoever shot at it. `world.ts` freezes it for the same reason.
  if (cart.dead) return;

  ctx.stats.directHits += 1;
  cart.strokesTaken += 1;
  if (applyDamage(cart.health, STROKE_DAMAGE)) ctx.onCartKilled(cart);
}

/**
 * Both carts take damage and both are shoved apart. The shove is added to `shuntVelocity`, which
 * Cart decays exactly like recoil -- never an impulse, because a KinematicCharacterController
 * receives none (docs/DECISIONS.md, physics ownership).
 *
 * Not counted in `directHits`: that stat feeds shot accuracy, and ramming is not a shot.
 */
function cartsShunt(a: Cart, b: Cart, ctx: CombatContext): void {
  cartVelocity(a, velA);
  cartVelocity(b, velB);
  const closing = Math.hypot(velA.x - velB.x, velA.z - velB.z);
  if (closing < SHUNT_MIN_SPEED) return;

  // A ram can kill, and it takes the same stroke penalty a shot does -- death has one path.
  const damage = closing * SHUNT_DAMAGE_PER_MPS;
  if (applyDamage(a.health, damage)) ctx.onCartKilled(a);
  if (applyDamage(b.health, damage)) ctx.onCartKilled(b);

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
