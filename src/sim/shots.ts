/**
 * Firing: a trigger pull into a pooled ball, crediting a hit, the Mulligan Mortar (its target,
 * barrage and splash), and the read-only aim-preview arc.
 *
 * Split out of `world.ts` in Stage 9 (docs/superpowers/specs/2026-11-28-stage-9-refactor-design.md
 * §4): functions over the `Sim`, called by its fixed step in the order they always ran.
 */
import { CLUB_STATS, computeLaunchVelocityInto } from "../physics/Ballistics";
import { computeMuzzle } from "./entities/Cart";
import { BALL_RADIUS } from "./entities/ballShape";
import { sameSide } from "./combat";
import { applyDamage } from "./health";
import {
  Barrage,
  MORTAR_BALLS,
  MORTAR_BALL_DAMAGE,
  MORTAR_DROP_HEIGHT_M,
  MORTAR_MAX_RANGE_M,
  MORTAR_SPLASH_DAMAGE,
  MORTAR_SPLASH_M,
} from "./mortar";
import type { Vec3 } from "./course";
import { NO_TARGET } from "./bot";
import { NO_RIG } from "./events";
import {
  FIXED_DT,
  PREVIEW_MAX_POINTS,
  PREVIEW_MAX_TICKS,
  PREVIEW_SAMPLE_STRIDE,
} from "./tickConstants";
import type { Sim } from "./world";
import { GRAVITY } from "./physicsWorld";
import type { CartRig } from "./rigs";
import { killCart } from "./respawn";

export function writePreviewPoint(out: Vec3[], i: number, x: number, y: number, z: number): void {
  const p = out[i]!;
  p.x = x;
  p.y = y;
  p.z = z;
}

/**
 * Air drag on a fired ball, mirrored by `previewTrajectory` so the aim arc matches the flight.
 * Must equal `BallPool`'s own linear damping; `previewTrajectory.test.ts` holds the two together
 * by landing a real shot where the preview said it would.
 */
export const LINEAR_DAMPING = 0.05;

/** Handed to Rapier; read, never kept. */
export const IDENTITY_ROTATION = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

export const ZERO_VECTOR = Object.freeze({ x: 0, y: 0, z: 0 });

/**
 * A mortar call: where it lands, then a barrage slot with its six impact points drawn now.
 * The player's lands where the full-charge arc of the equipped club does, along the turret,
 * capped at `MORTAR_MAX_RANGE_M` and pulled inside the zone. Refused, keeping the mortar, only
 * when every slot is in use.
 */
export function callMortar(sim: Sim, rig: CartRig): void {
  const cart = rig.cart;
  let slot: Barrage | null = null;
  for (const b of sim.barrages) if (!b.active && slot === null) slot = b;
  if (slot === null) return;
  const target = mortarTarget(sim, rig, sim.clampScratch);
  cart.mortars = 0;
  slot.start(rig.index, sim.tickCount, target.x, target.z, sim.mortarRandom);
  const y = sim.playfield.heightAt(target.x, target.z);
  sim.events.push("mortarCalled", sim.tickCount, rig.index, NO_RIG, 0, target.x, y, target.z);
}

export function mortarTarget(sim: Sim, rig: CartRig, out: { x: number; z: number }): { x: number; z: number } {
  const cart = rig.cart;
  const from = cart.position;
  let dx: number;
  let dz: number;
  if (rig.random === null) {
    // The player aims with the arc: `previewTrajectory` reads rig 0's cart.
    const n = previewTrajectory(sim, 1, cart.turretYaw, sim.mortarArc);
    const land = sim.mortarArc[Math.max(0, n - 1)]!;
    dx = land.x - from.x;
    dz = land.z - from.z;
  } else {
    // A bot aims where its target is now, with no lead, so a target that keeps moving escapes
    // the ring as the player can (spec §3.5). `shouldCallMortar` only calls on a living one.
    const target = rig.targetIndex === NO_TARGET ? cart : sim.rigs[rig.targetIndex]!.cart;
    dx = target.position.x - from.x;
    dz = target.position.z - from.z;
  }
  const d = Math.hypot(dx, dz);
  if (d > MORTAR_MAX_RANGE_M) {
    dx *= MORTAR_MAX_RANGE_M / d;
    dz *= MORTAR_MAX_RANGE_M / d;
  }
  out.x = from.x + dx;
  out.z = from.z + dz;
  if (sim.zone !== null) sim.zone.clampInside(out.x, out.z, out);
  return out;
}

/**
 * Drops each live barrage's balls on their ticks. A ball is a pooled body like any shot, so every
 * rule that makes a shot hurt applies to it unchanged; one the pool cannot supply is skipped.
 */
export function stepBarrages(sim: Sim): void {
  for (let b = 0; b < sim.barrages.length; b++) {
    const barrage = sim.barrages[b]!;
    if (!barrage.active) continue;
    while (barrage.spawned < MORTAR_BALLS && barrage.dropTick(barrage.spawned) <= sim.tickCount) {
      const i = barrage.spawned++;
      const pooled = sim.ballPool.acquire(barrage.owner, true);
      if (pooled === null) continue;
      const x = barrage.impacts[i * 2]!;
      const z = barrage.impacts[i * 2 + 1]!;
      const at = sim.muzzleScratch;
      at.x = x;
      at.y = sim.playfield.heightAt(x, z) + MORTAR_DROP_HEIGHT_M;
      at.z = z;
      pooled.body.setTranslation(at, true);
      pooled.body.setRotation(IDENTITY_ROTATION, true);
      pooled.body.setAngvel(ZERO_VECTOR, true);
      pooled.body.setLinvel(sim.mortarVelocity, true);
      pooled.body.setGravityScale(1, true);
      pooled.damage = MORTAR_BALL_DAMAGE;
      pooled.mortar = true;
    }
    if (barrage.spawned >= MORTAR_BALLS) barrage.clear();
  }
}

/**
 * One point to every enemy within `MORTAR_SPLASH_M` of each mortar ball that touched down sim
 * step, credited to the caller. The only splash in the game, so it repeats the guards a direct
 * hit has in `combat.ts`: a dead, protected or same-side cart is untouched, a shield plate takes
 * it whole, and the cart the ball already hit is spared.
 */
export function applySplash(sim: Sim): void {
  const pool = sim.ballPool;
  const balls = pool.all;
  for (let t = 0; t < pool.touchdownCount; t++) {
    const ball = balls[pool.touchdowns[t]!]!;
    const bx = ball.position[0]!;
    const by = ball.position[1]!;
    const bz = ball.position[2]!;
    for (let i = 0; i < sim.rigs.length; i++) {
      const cart = sim.rigs[i]!.cart;
      if (i === ball.struck || cart.dead || cart.protectedFor > 0 || sameSide(ball.firedBy, i)) continue;
      if (Math.hypot(cart.position.x - bx, cart.position.z - bz) > MORTAR_SPLASH_M) continue;
      if (cart.absorbHit()) {
        sim.events.push("plateBroken", sim.tickCount, ball.firedBy, i, cart.shield, bx, by, bz);
        continue;
      }
      sim.tally.damaged(ball.firedBy, i, MORTAR_SPLASH_DAMAGE, sim.tickCount);
      sim.events.push("hit", sim.tickCount, ball.firedBy, i, MORTAR_SPLASH_DAMAGE, bx, by, bz);
      if (applyDamage(cart.health, MORTAR_SPLASH_DAMAGE)) killCart(sim, cart, i, ball.firedBy);
    }
  }
}

/**
 * A fired ball connected, and `shooter` is the rig that fired it. `Sim.stats` is the **player's**
 * -- it is the accuracy the results screen reports -- so only rig 0's hits may write it. The event
 * is everyone's: whoever reads the log decides whose hits it shows.
 */
export function creditHit(sim: Sim, shooter: number, victim: number, damage: number, x: number, y: number, z: number): void {
  if (shooter === 0) sim.stats.directHits += 1;
  sim.tally.damaged(shooter, victim, damage, sim.tickCount);
  sim.events.push("hit", sim.tickCount, shooter, victim, damage, x, y, z);
}

/**
 * A trigger pull. With ammo it spawns a pooled ball at the muzzle; at zero ammo it was a blank,
 * whose recoil `Cart` has already applied. Only the player's shots count toward `Sim.stats`.
 */
export function resolveShot(sim: Sim, rig: CartRig): void {
  const cart = rig.cart;
  const isPlayer = rig.index === 0;
  if (!cart.shot.hasBall) {
    if (isPlayer) sim.lastShotWasStrike = false;
    pushDry(sim, rig);
    return;
  }

  // The player's shot may take a bot's ball out of the air rather than be refused; a bot's may
  // not (BallPool.acquire, and docs/DECISIONS.md, 2026-09-27).
  const pooled = sim.ballPool.acquire(rig.index, isPlayer);
  if (!pooled) {
    // Every pooled body is in flight at once. `Cart.fire()` already spent the round on the
    // assumption a ball would spawn; refund it so sim degrades to a true no-op.
    cart.addAmmo(1);
    if (isPlayer) sim.lastShotWasStrike = false;
    pushDry(sim, rig);
    return;
  }

  if (isPlayer) {
    sim.lastShotWasStrike = true;
    // "A shot fired" for accuracy purposes is a ball actually leaving the muzzle -- distinct
    // from ammo's own decrement, which a 0-ammo blank also triggers.
    sim.stats.shotsFired += 1;
  }
  computeMuzzle(cart, sim.muzzleScratch);
  pooled.body.setTranslation(sim.muzzleScratch, true);
  pooled.body.setRotation(IDENTITY_ROTATION, true);
  pooled.body.setAngvel(ZERO_VECTOR, true);
  pooled.body.setLinvel(
    computeLaunchVelocityInto(cart.shot.club, cart.shot.charge01, cart.shot.yaw, sim.launchScratch),
    true,
  );
  // Set on every shot: the pool recycles bodies, so a putter ball may last have been a driver's.
  const stats = CLUB_STATS[cart.shot.club];
  pooled.body.setGravityScale(stats.gravityScale, true);
  pooled.damage = stats.damage;
  const m = sim.muzzleScratch;
  sim.events.push("shot", sim.tickCount, rig.index, NO_RIG, 0, m.x, m.y, m.z, cart.shot.club);
}

/** A trigger pull that put nothing in the air, at the cart's own muzzle. */
export function pushDry(sim: Sim, rig: CartRig): void {
  computeMuzzle(rig.cart, sim.muzzleScratch);
  const m = sim.muzzleScratch;
  sim.events.push("dry", sim.tickCount, rig.index, NO_RIG, 0, m.x, m.y, m.z);
}

/**
 * A read-only forward integration of the shot that firing *now* would make, for the aim-preview
 * arc (UI-SPEC H10). Fills `out` with points from the muzzle to the ball's first ground contact
 * and returns how many it wrote.
 *
 * **It touches no Rapier state and advances nothing** -- `Sim` is byte-identical before and after.
 * It mirrors the ball's own flight integration (the club's scaled gravity plus `LINEAR_DAMPING` at `FIXED_DT`)
 * rather than reading the live world, so it is a pure function of its inputs. It predicts the
 * carry, not the roll: the arc ends where the ball lands, because that is what a player aims with.
 *
 * The equipped club is read from the cart, not passed: its loft sets both the muzzle and the
 * launch elevation. `out` is a caller-held buffer of at least `PREVIEW_MAX_POINTS` reused `Vec3`s.
 */
export function previewTrajectory(sim: Sim, charge01: number, yaw: number, out: Vec3[]): number {
  computeMuzzle(sim.cart, sim.previewScratch);
  let px = sim.previewScratch.x;
  let py = sim.previewScratch.y;
  let pz = sim.previewScratch.z;

  const v = computeLaunchVelocityInto(sim.cart.equippedClub, charge01, yaw, sim.launchScratch);
  let vx = v.x;
  let vy = v.y;
  let vz = v.z;

  const gravity = GRAVITY * CLUB_STATS[sim.cart.equippedClub].gravityScale;
  const damp = 1 / (1 + LINEAR_DAMPING * FIXED_DT);
  const bounds = sim.playfield.bounds;
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

    const ground = sim.playfield.heightAt(px, pz) + BALL_RADIUS;
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
