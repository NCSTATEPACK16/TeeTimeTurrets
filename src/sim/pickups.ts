import { BUCKET_REFILL_AMMO } from "./entities/Cart";
import { createBucket, stepBucket, tryTakeBucket } from "./entities/Pickup";
import type { Bucket } from "./entities/Pickup";
import type { BallPool } from "./entities/BallPool";
import type { MatchTally } from "./scoring";
import type { ArenaGround } from "./arena";
import { NO_TARGET_RIG } from "./events";
import type { SimEventLog } from "./events";
import { FIXED_DT } from "./frame";
import type { CartRig } from "./rigs";

/**
 * How close a cart has to be to a landed ball or a bucket to collect it. Ammo is the only thing a
 * landed ball is for, so driving over your own spent rounds is how a cart reloads between buckets.
 */
export const PICKUP_RANGE = 3.0;

/**
 * Puts the match's ammo buckets on the ground, into `buckets`. One for now.
 *
 * **A known misplacement, kept because moving it moves the golden fingerprint:** this is hole 1's
 * *local* tee plus 10 m, read as a course coordinate, which is where the arena has always put its
 * bucket. Stage 7's `sim/pickups` depot ring at the clubhouse is where it gets its real place.
 */
export function placeBuckets(ground: ArenaGround, buckets: Bucket[]): void {
  const firstHole = ground.holes.find((h) => h.spec.index === 0) ?? ground.holes[0]!;
  buckets.push(createBucket(firstHole.spec.tee.x + 10, firstHole.spec.tee.z));
}

/** Every bucket's cooldown, one tick on. */
export function stepBuckets(buckets: readonly Bucket[]): void {
  for (const bucket of buckets) stepBucket(bucket, FIXED_DT);
}

/** Every bucket off cooldown, for a rematch. */
export function resetBuckets(buckets: readonly Bucket[]): void {
  for (const bucket of buckets) bucket.cooldownRemaining = 0;
}

/**
 * Whatever ammo is in reach of one living cart: a bucket off cooldown refills it, and each landed
 * ball in range is one round back to the pool. One `pickup` event for whatever this tick collected,
 * and one to the player's tally.
 */
export function collectPickups(
  rig: CartRig,
  buckets: readonly Bucket[],
  pool: BallPool,
  events: SimEventLog,
  tally: MatchTally,
): void {
  const cart = rig.cart;
  const c = cart.position;
  const ammoBefore = cart.ammo;
  let collected = false;
  for (const bucket of buckets) {
    if (tryTakeBucket(bucket, c.x, c.z, PICKUP_RANGE)) {
      cart.addAmmo(BUCKET_REFILL_AMMO);
      collected = true;
    }
  }
  for (const landed of pool.ballsNear(c.x, c.z, PICKUP_RANGE)) {
    cart.addAmmo(1);
    pool.release(landed);
    collected = true;
  }
  // One event for whatever this tick collected, with the rounds it actually gave: a full magazine
  // still takes the bucket, and says so with a zero.
  if (collected && rig.index === 0) tally.pickups += 1;
  if (collected) events.push("pickup", rig.index, NO_TARGET_RIG, c.x, c.y, c.z, cart.ammo - ammoBefore, null);
}
