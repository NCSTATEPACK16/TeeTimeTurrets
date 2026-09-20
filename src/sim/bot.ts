import { applyAimSpread } from "../physics/Ballistics";
import type { PlayerIntent } from "../input/InputSource";
import { CART_TUNING } from "./entities/Cart";
import type { Cart } from "./entities/Cart";

/**
 * The AI opponent, as one pure function of exactly the state it needs: its own cart, and where
 * the thing it is fighting happens to be. Structural rather than a method on `Cart` or `Sim`,
 * the same way `hudState.ts`'s `HudSource` is -- it makes the whole behaviour testable with no
 * Rapier world and no `Sim` at all.
 *
 * DOM-free and Rapier-free like everything else in `src/sim/**`. Deliberately has no memory:
 * everything it needs to decide is already on the cart it is driving.
 */

/**
 * Metres. Outside this the bot drives at its target but does not aim or shoot.
 *
 * It used to idle out here instead, on the reasoning that closing would be pathfinding across the
 * course. That held while the arena was one generated hole and every cart was tens of metres from
 * the next. The authored eighteen-hole routing deals carts one to a hole: the closest two tees on
 * the whole course are 74 m apart, so under the old rule every bot in every match stood still from
 * the opening tick and arena combat did not happen at all.
 *
 * Closing is not pathfinding. It is the same straight-line drive the bot already did inside this
 * range -- no navigation, no obstacle avoidance, no memory -- so a bot can still be stopped by
 * water or a wood between it and its target. That is a real gap and it is deferred, not solved
 * here; what is fixed is that the bot now tries.
 */
export const BOT_ENGAGE_RANGE = 40;
/**
 * Metres. Inside this the bot stops closing and holds station.
 *
 * This is not a comfort distance -- it is the range at which the bot's shot actually lands on a
 * cart. Bots fire the **putter** (see `world.ts`), and a fired ball leaves the muzzle (~2.4 m up)
 * at the club's own loft, so where it comes back down to cart height is fixed by club and charge,
 * not by aim. Measured against the real Rapier world (`_botspike`, since removed): a putter fired
 * at `BOT_CHARGE_RELEASE` passes through cart height (0.2-1.3 m above ground) at **6.4-7.6 m** and
 * lands at 7.8 m. Standing off at 7 m puts the target in that band.
 *
 * A lofted club is why the old value was wrong. The bot used to fire the driver from 12 m; a
 * driver (13 deg) does not come back to cart height until ~63 m, so every shot sailed clean over
 * the target -- five bots at ~10 m for eighty seconds left the player's health untouched across
 * 10,321 fire ticks. The fix is the club-and-standoff pairing, measured, not a bigger number.
 */
export const BOT_STANDOFF = 7;
/**
 * Metres. The bot pulls the trigger only inside this -- just past the putter's ~7.8 m reach, with
 * room for a target closing onto the shot. Aiming still begins at `BOT_ENGAGE_RANGE`, so the
 * turret is already lined up by the time the target is in range; but firing while still closing
 * from 40 m would empty the bot's 30-ball magazine into the dirt short of the target. Every
 * trigger pull inside this range is a shot that can connect.
 */
export const BOT_FIRE_RANGE = 9;
/** Radians per second of turret slew. Bounded so the bot's aim is not instant and omniscient. */
export const BOT_AIM_RATE = 1.2;
/** Radians. Inside this bearing error the bot considers itself on target and starts charging. */
export const BOT_FIRE_TOLERANCE = 0.12;
/** Radians of heading error at which the bot asks for full steering lock. */
export const BOT_STEER_FULL = 0.6;
/** Charge fraction at which the bot lets go of the trigger. */
export const BOT_CHARGE_RELEASE = 0.8;
/**
 * Metres per second below which the bot, once it has arrived at the standoff, stops braking and
 * simply holds station. Without a floor a bot fights its own brake forever; with one it coasts the
 * last sliver to rest and sits in the firing band.
 */
export const BOT_HOLD_SPEED = 1;
/**
 * Channel index for a bot's RNG, alongside terrain (0), surfaces (1) and course layout (2).
 * `hashChannel(seed, index, BOT_CHANNEL, botIndex)` gives each bot its own independent stream,
 * so bot behaviour is reproducible per seed and no bot's draws shift another's.
 */
export const BOT_CHANNEL = 3;

/**
 * What the bot is engaging. Not a `Cart`, because the bot must not be able to read its target's
 * ammo, charge or health -- and because `dead` is the only thing about the target beyond its
 * position that the bot is allowed to know.
 */
export interface BotTarget {
  readonly x: number;
  readonly z: number;
  /** A dead target is not engaged at all: that is what stops a bot camping a respawn point. */
  readonly dead: boolean;
}

/**
 * Writes this tick's intent for `bot` into `out`.
 *
 * Aim, drive and fire, and nothing else -- no pathfinding, no hazard avoidance beyond what
 * `cartSpeedScale` already does for free through the shared `Cart.step`, no seeking out an ammo
 * bucket when it runs dry. Those are real navigation problems and are deliberately deferred.
 *
 * The firing model is the interesting part. `Cart.step` charges while `fire` is held and shoots
 * on the *release* edge, so a bot that simply held the trigger would never fire. Instead the bot
 * reads its own `charge` and lets go once it is charged enough -- which makes a charge-and-release
 * weapon drivable from a function with no state of its own.
 *
 * `random` is consumed at most once per call, and only on a release tick.
 */
export function computeBotIntent(
  bot: Cart,
  target: BotTarget,
  dt: number,
  random: () => number,
  out: PlayerIntent,
): void {
  out.throttle = 0;
  out.steer = 0;
  out.brake = false;
  out.aimDelta = 0;
  out.fire = false;
  out.selectClub = null;

  const dx = target.x - bot.position.x;
  const dz = target.z - bot.position.z;
  const distance = Math.hypot(dx, dz);
  if (target.dead || distance < 1e-6) return;

  const bearing = Math.atan2(dz, dx);

  // Drive: turn the chassis toward the target and *arrive* at the standoff, then hold station. This
  // runs at any distance -- see `BOT_ENGAGE_RANGE` for why it no longer stops at it.
  //
  // Arrival, not a hard cutoff: the bot closes at full throttle only while it still has room to
  // brake to rest by the standoff, and brakes once it does not. The trigger is the cart's own
  // stopping distance (v^2 / 2a at the shared brake rate), so the behaviour holds at any top speed
  // -- a cart tuned to drive twice as fast begins braking twice as far out and still settles in the
  // firing band, instead of charging clean through the standoff and never holding still to shoot.
  const headingError = wrapAngle(bearing - bot.heading);
  out.steer = clampSigned(headingError / BOT_STEER_FULL);
  const gap = distance - BOT_STANDOFF;
  const stoppingDistance = (bot.speed * bot.speed) / (2 * CART_TUNING.brakeDecel);
  if (gap > 0) {
    if (stoppingDistance >= gap) out.brake = true; // no longer enough room -- shed speed now
    else out.throttle = 1; // room to keep closing
  } else {
    // Inside the standoff: hold station, braking hardest deep in and whenever still rolling.
    out.brake = distance < BOT_STANDOFF * 0.5 || bot.speed > BOT_HOLD_SPEED;
  }

  // Beyond the tracking range the bot only drives -- no aim, no fire. Closing changed where the
  // bot goes (see `BOT_ENGAGE_RANGE`), not what it can hit.
  if (distance > BOT_ENGAGE_RANGE) return;

  // Aim: ease the turret toward the bearing at a bounded rate. Done from the full tracking range
  // so the turret is lined up before the target is close enough to shoot.
  const aimError = wrapAngle(bearing - bot.turretYaw);
  const maxSlew = BOT_AIM_RATE * dt;
  out.aimDelta = Math.min(maxSlew, Math.max(-maxSlew, aimError));

  // Fire only within the putter's actual reach, on top of being aimed and having ammo -- see
  // `BOT_FIRE_RANGE` for why a bot that shot the moment it had a bearing would just waste its magazine.
  const wantsToFire =
    distance <= BOT_FIRE_RANGE && Math.abs(aimError) < BOT_FIRE_TOLERANCE && bot.ammo > 0;
  out.fire = wantsToFire && bot.charge < BOT_CHARGE_RELEASE;

  // On the release tick, offset the turret inside the club's own accuracy cone. This is the
  // per-shot spread channel `applyAimSpread` was written for and never had a caller for; the
  // player's shots are deliberately unaffected.
  if (wantsToFire && !out.fire) {
    out.aimDelta += applyAimSpread(0, bot.equippedClub, random);
  }
}

/** Folds an angle into [-PI, PI], so an error either side of the wrap turns the short way. */
function wrapAngle(radians: number): number {
  return Math.atan2(Math.sin(radians), Math.cos(radians));
}

function clampSigned(v: number): number {
  return Math.min(1, Math.max(-1, v));
}
