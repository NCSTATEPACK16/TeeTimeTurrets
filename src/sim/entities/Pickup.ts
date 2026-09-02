/** Sim-only refill bucket for cart-mode combat. See docs/superpowers/specs/2026-09-02-cart-ammo-design.md §7
 * for why bucket placement is hardcoded to a single test position for now. */

export interface Bucket {
  position: { x: number; z: number };
  cooldownRemaining: number;
}

export const BUCKET_COOLDOWN_S = 60;

export function createBucket(x: number, z: number): Bucket {
  return { position: { x, z }, cooldownRemaining: 0 };
}

export function stepBucket(bucket: Bucket, dt: number): void {
  if (bucket.cooldownRemaining > 0) {
    bucket.cooldownRemaining = Math.max(0, bucket.cooldownRemaining - dt);
  }
}

/**
 * Returns true if the bucket was taken (cart in range, bucket off cooldown), and starts its
 * cooldown in that case. Does not grant ammo itself -- the caller (world.ts) decides that, so
 * that "still consumes the bucket even at MAX_AMMO" is the caller's clamp-and-consume choice,
 * not this module's.
 */
export function tryTakeBucket(bucket: Bucket, cartX: number, cartZ: number, range: number): boolean {
  if (bucket.cooldownRemaining > 0) return false;
  const dist = Math.hypot(bucket.position.x - cartX, bucket.position.z - cartZ);
  if (dist > range) return false;
  bucket.cooldownRemaining = BUCKET_COOLDOWN_S;
  return true;
}
