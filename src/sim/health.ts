/**
 * Pure HP model -- no Rapier, no timers, no entity knowledge. Damage is applied by combat.ts and
 * owned by whatever holds a Health (a Cart today; a target dummy or a flag carrier later).
 *
 * Deliberately not a class: this is data plus three transforms, the same shape surfaces.ts and
 * Pickup.ts already use, and it keeps the module trivially reusable on an authoritative server.
 */

export interface Health {
  hp: number;
  readonly max: number;
}

export function createHealth(max: number): Health {
  return { hp: max, max };
}

/**
 * Returns true iff this call took hp from above zero to zero -- i.e. this is the killing blow.
 * Damage against an already-dead health is a no-op returning false, which is what makes two
 * lethal contacts landing in the same tick (a ball hit and a shunt) unable to double-trigger a
 * death, per the spec's edge-case list.
 */
export function applyDamage(h: Health, amount: number): boolean {
  if (amount <= 0 || h.hp <= 0) return false;
  h.hp = Math.max(0, h.hp - amount);
  return h.hp === 0;
}

export function heal(h: Health, amount: number): void {
  if (amount <= 0) return;
  h.hp = Math.min(h.max, h.hp + amount);
}
