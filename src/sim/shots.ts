import { CLUB_STATS, computeLaunchVelocity } from "../physics/Ballistics";
import { computeMuzzle } from "./entities/Cart";
import type { Cart } from "./entities/Cart";
import type { BallPool } from "./entities/BallPool";
import { BALL_RADIUS } from "./entities/ballShape";
import type { Stats } from "./stats";
import { NO_TARGET_RIG } from "./events";
import type { SimEventLog } from "./events";
import type { Playfield } from "./playfield";
import type { Vec3 } from "./course";
import type { CartRig } from "./rigs";
import { GRAVITY } from "./physicsWorld";
import { FIXED_DT, PREVIEW_MAX_POINTS, PREVIEW_MAX_TICKS, PREVIEW_SAMPLE_STRIDE } from "./frame";

/**
 * Air drag on a fired ball, mirrored by `previewTrajectory` so the aim arc matches the flight.
 * Must equal `BallPool`'s own linear damping; `previewTrajectory.test.ts` holds the two together
 * by landing a real shot where the preview said it would.
 */
const LINEAR_DAMPING = 0.05;

/**
 * A trigger pull. With ammo it spawns a pooled ball at the muzzle; at zero ammo it was a blank,
 * whose recoil `Cart` has already applied. Only the player's shots count toward `stats`.
 *
 * Returns whether a ball left the muzzle, which is what `Sim.lastShotWasStrike` reports for the
 * player. `muzzle` is the caller's scratch.
 */
export function resolveShot(
  rig: CartRig,
  pool: BallPool,
  events: SimEventLog,
  stats: Stats,
  muzzle: Vec3,
): boolean {
  const cart = rig.cart;
  const isPlayer = rig.index === 0;
  computeMuzzle(cart, muzzle);
  if (!cart.shot.hasBall) {
    events.push("dryfire", rig.index, NO_TARGET_RIG, muzzle.x, muzzle.y, muzzle.z, 0, cart.shot.club);
    return false;
  }

  const pooled = pool.acquire(rig.index);
  if (!pooled) {
    // Every pooled body is up in the air at once. `Cart.fire()` already spent the round on the
    // assumption a ball would spawn; refund it so this degrades to a true no-op -- one that
    // sounds like an empty trigger rather than like nothing.
    cart.addAmmo(1);
    events.push("dryfire", rig.index, NO_TARGET_RIG, muzzle.x, muzzle.y, muzzle.z, 0, cart.shot.club);
    return false;
  }

  if (isPlayer) {
    // "A shot fired" for accuracy purposes is a ball actually leaving the muzzle -- distinct
    // from ammo's own decrement, which a 0-ammo blank also triggers.
    stats.shotsFired += 1;
  }
  events.push("shot", rig.index, NO_TARGET_RIG, muzzle.x, muzzle.y, muzzle.z, cart.shot.charge01, cart.shot.club);
  pooled.body.setTranslation(muzzle, true);
  pooled.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  pooled.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  pooled.body.setLinvel(computeLaunchVelocity(cart.shot.club, cart.shot.charge01, cart.shot.yaw), true);
  // Set on every shot: the pool recycles bodies, so a putter ball may last have been a driver's.
  const club = CLUB_STATS[cart.shot.club];
  pooled.body.setGravityScale(club.gravityScale, true);
  pooled.damage = club.damage;
  return true;
}

function writePreviewPoint(out: Vec3[], i: number, x: number, y: number, z: number): void {
  const p = out[i]!;
  p.x = x;
  p.y = y;
  p.z = z;
}

/**
 * A read-only forward integration of the shot that firing `cart` *now* would make, for the
 * aim-preview arc (UI-SPEC H10). Fills `out` with points from the muzzle to the ball's first ground
 * contact and returns how many it wrote.
 *
 * **It touches no Rapier state and advances nothing** -- `Sim` is byte-identical before and after.
 * It mirrors the ball's own flight integration (the club's scaled gravity plus `LINEAR_DAMPING` at
 * `FIXED_DT`) rather than reading the live world, so it is a pure function of its inputs. It
 * predicts the carry, not the roll: the arc ends where the ball lands, because that is what a
 * player aims with.
 *
 * The equipped club is read from the cart, not passed: its loft sets both the muzzle and the
 * launch elevation. `out` is a caller-held buffer of at least `PREVIEW_MAX_POINTS` reused `Vec3`s,
 * and `scratch` a caller-held point.
 */
export function previewTrajectory(
  playfield: Playfield,
  cart: Cart,
  charge01: number,
  yaw: number,
  out: Vec3[],
  scratch: Vec3,
): number {
  computeMuzzle(cart, scratch);
  let px = scratch.x;
  let py = scratch.y;
  let pz = scratch.z;

  const v = computeLaunchVelocity(cart.equippedClub, charge01, yaw);
  let vx = v.x;
  let vy = v.y;
  let vz = v.z;
  const gravity = GRAVITY * CLUB_STATS[cart.equippedClub].gravityScale;
  const damp = 1 / (1 + LINEAR_DAMPING * FIXED_DT);
  const bounds = playfield.bounds;
  const capacity = Math.min(out.length, PREVIEW_MAX_POINTS);

  let n = 0;
  writePreviewPoint(out, n++, px, py, pz); // the muzzle itself

  for (let tick = 1; tick <= PREVIEW_MAX_TICKS && n < capacity; tick++) {
    // Gravity then damping then integrate, the order Rapier applies to the real ball.
    vy -= gravity * FIXED_DT;
    vx *= damp;
    vy *= damp;
    vz *= damp;
    px += vx * FIXED_DT;
    py += vy * FIXED_DT;
    pz += vz * FIXED_DT;

    const ground = playfield.heightAt(px, pz) + BALL_RADIUS;
    const landed = py <= ground;
    const outside = px < bounds.minX || px > bounds.maxX || pz < bounds.minZ || pz > bounds.maxZ;

    if (landed || outside || tick % PREVIEW_SAMPLE_STRIDE === 0) {
      if (landed) py = ground; // the last point rests on the surface, not just under it
      writePreviewPoint(out, n++, px, py, pz);
    }
    if (landed || outside) break;
  }
  return n;
}
