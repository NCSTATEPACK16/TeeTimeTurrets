import { BUCKET_REFILL_AMMO, MAX_AMMO } from "./entities/Cart";
import type { Cart } from "./entities/Cart";
import type { PickupSite, PickupType } from "./pickupSites";

/**
 * Pickup collection (`docs/art/specs/sim-slices.md` §3, on top of the Stage D spec): where the
 * sites are is `pickupSites.ts`'s job, computed once per course; this is what happens at them.
 *
 * A site is charged until a cart takes it, then recharges for `PICKUP_COOLDOWN_S`. The cooldown
 * is the site's, not the taker's: a cart that takes a hot dog denies it to everyone for a minute.
 *
 * **A cart cannot take what it cannot use.** A full magazine passes through a bucket, full health
 * through a hot dog, a full shield through a drink, and the site stays charged. Wasting a pickup
 * by driving past it felt bad, and deliberate denial can come later if play-tests ask for it.
 */

/** Seconds a taken site takes to recharge. */
export const PICKUP_COOLDOWN_S = 60;
/** How close a cart must come. Wider than the 1.5 m pillar on purpose (Stage D spec). */
export const PICKUP_GRAB_RADIUS_M = 3;
/** HP a hot dog restores. */
export const HOT_DOG_HEAL = 3;
/** Plates a drink gives, which is also the most a cart can carry. */
export const SHIELD_PLATES = 2;
/** Seconds before one plate decays by itself. */
export const SHIELD_DECAY_S = 10;

/** One site's live state. `readyAt` is sim seconds; 0 means charged from the first tick. */
export interface PickupState {
  readonly site: PickupSite;
  readyAt: number;
}

export function createPickupStates(sites: readonly PickupSite[]): PickupState[] {
  return sites.map((site) => ({ site, readyAt: 0 }));
}

export function isCharged(state: PickupState, now: number): boolean {
  return now >= state.readyAt;
}

/** Whether `cart` would get anything from a pickup of `type` right now. */
export function canUse(cart: Cart, type: PickupType): boolean {
  switch (type) {
    case "bucket":
      return cart.ammo < MAX_AMMO;
    case "hot_dog":
      return cart.health.hp < cart.health.max;
    case "drink":
      return cart.shield < SHIELD_PLATES;
  }
}

/**
 * The first charged site within reach of (x, z) that `cart` can use, or -1. Sites never overlap
 * within a grab radius (the depot ring is 6 m around, the scatter far wider), so "first" is
 * "only". Allocation-free: it runs per cart per tick.
 */
export function siteInReach(states: readonly PickupState[], cart: Cart, now: number): number {
  const x = cart.position.x;
  const z = cart.position.z;
  const r2 = PICKUP_GRAB_RADIUS_M * PICKUP_GRAB_RADIUS_M;
  for (let i = 0; i < states.length; i++) {
    const s = states[i]!;
    if (now < s.readyAt) continue;
    const dx = s.site.x - x;
    const dz = s.site.z - z;
    if (dx * dx + dz * dz > r2) continue;
    if (!canUse(cart, s.site.type)) continue;
    return i;
  }
  return -1;
}

/** Takes site `i` for `cart` at `now`: applies its effect and starts the site's cooldown. */
export function take(states: readonly PickupState[], i: number, cart: Cart, now: number): void {
  const s = states[i]!;
  s.readyAt = now + PICKUP_COOLDOWN_S;
  switch (s.site.type) {
    case "bucket":
      cart.addAmmo(BUCKET_REFILL_AMMO);
      return;
    case "hot_dog":
      cart.heal(HOT_DOG_HEAL);
      return;
    case "drink":
      cart.grantShield(SHIELD_PLATES, SHIELD_DECAY_S);
      return;
  }
}

/** Every site charged again, for a rematch. */
export function resetPickups(states: readonly PickupState[]): void {
  for (const s of states) s.readyAt = 0;
}

/**
 * The nearest charged site of `type` to (x, z) within `maxDistance`, written into `out`; false
 * when there is none. For bots heading for a pickup. Allocation-free.
 */
export function nearestCharged(
  states: readonly PickupState[],
  type: PickupType,
  now: number,
  x: number,
  z: number,
  maxDistance: number,
  out: { x: number; z: number },
): boolean {
  let best = maxDistance;
  let found = false;
  for (let i = 0; i < states.length; i++) {
    const s = states[i]!;
    if (s.site.type !== type || now < s.readyAt) continue;
    const d = Math.hypot(s.site.x - x, s.site.z - z);
    if (d <= best) {
      best = d;
      out.x = s.site.x;
      out.z = s.site.z;
      found = true;
    }
  }
  return found;
}
