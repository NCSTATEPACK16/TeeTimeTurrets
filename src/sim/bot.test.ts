import { describe, expect, it } from "vitest";
import { neutralIntent } from "../input/InputSource";
import type { PlayerIntent } from "../input/InputSource";
import { Cart } from "./entities/Cart";
import { mulberry32 } from "./rng";
import {
  BOT_CHARGE_RELEASE,
  BOT_ENGAGE_RANGE,
  BOT_FIRE_TOLERANCE,
  BOT_STANDOFF,
  computeBotIntent,
} from "./bot";

const DT = 1 / 60;

function botAt(x: number, z: number, heading = 0): Cart {
  const cart = new Cart({ position: { x, y: 0, z }, heading, maxHealth: 8 });
  return cart;
}

function intentFor(
  bot: Cart,
  target: { x: number; z: number; dead?: boolean },
  random: () => number = mulberry32(1),
): PlayerIntent {
  const out = neutralIntent();
  computeBotIntent(bot, { x: target.x, z: target.z, dead: target.dead ?? false }, DT, random, out);
  return out;
}

describe("computeBotIntent", () => {
  it("idles outside its engagement range rather than pathfinding across the course", () => {
    const intent = intentFor(botAt(0, 0), { x: BOT_ENGAGE_RANGE + 5, z: 0 });
    expect(intent.throttle).toBe(0);
    expect(intent.steer).toBe(0);
    expect(intent.aimDelta).toBe(0);
    expect(intent.fire).toBe(false);
  });

  it("idles against a dead target, so it cannot camp a respawn point", () => {
    const intent = intentFor(botAt(0, 0), { x: 5, z: 0, dead: true });
    expect(intent.throttle).toBe(0);
    expect(intent.fire).toBe(false);
  });

  it("drives at a target it can see and stops closing at the standoff", () => {
    expect(intentFor(botAt(0, 0), { x: 30, z: 0 }).throttle).toBe(1);
    expect(intentFor(botAt(0, 0), { x: 4, z: 0 }).throttle).toBe(0);
  });

  it("brakes once it is well inside the standoff, rather than idling on momentum alone", () => {
    expect(intentFor(botAt(0, 0), { x: BOT_STANDOFF * 0.4, z: 0 }).brake).toBe(true);
    expect(intentFor(botAt(0, 0), { x: BOT_STANDOFF * 0.9, z: 0 }).brake).toBe(false);
  });

  it("steers toward the target and the sign follows which side it is on", () => {
    expect(intentFor(botAt(0, 0), { x: 20, z: 20 }).steer).toBeGreaterThan(0);
    expect(intentFor(botAt(0, 0), { x: 20, z: -20 }).steer).toBeLessThan(0);
  });

  it("slews the turret toward the target at a bounded rate rather than snapping to it", () => {
    const bot = botAt(0, 0);
    // Target dead abeam: a 90 degree aim error the bot must not close in one tick.
    const intent = intentFor(bot, { x: 0, z: 20 });
    expect(intent.aimDelta).toBeGreaterThan(0);
    expect(Math.abs(intent.aimDelta)).toBeLessThan(Math.PI / 2);
    expect(Math.abs(intent.aimDelta)).toBeLessThanOrEqual(1.2 * DT + 1e-9);
  });

  it("holds fire to charge while roughly aimed, then releases", () => {
    const bot = botAt(0, 0);
    expect(intentFor(bot, { x: 20, z: 0 }).fire).toBe(true);

    // Cart.step charges while `fire` is held; once charged enough the bot lets go, and the
    // release edge is what actually fires. This is how a stateless function drives a
    // charge-and-release weapon without carrying a timer of its own.
    (bot as unknown as { chargeHeld: number }).chargeHeld = BOT_CHARGE_RELEASE;
    expect(intentFor(bot, { x: 20, z: 0 }).fire).toBe(false);
  });

  it("does not hold fire while badly off-aim", () => {
    // Target behind the bot: aim error is pi, far outside the fire tolerance.
    expect(intentFor(botAt(0, 0), { x: -20, z: 0 }).fire).toBe(false);
    expect(BOT_FIRE_TOLERANCE).toBeLessThan(Math.PI / 4);
  });

  it("does not hold fire with no ammo", () => {
    const bot = botAt(0, 0);
    bot.ammo = 0;
    expect(intentFor(bot, { x: 20, z: 0 }).fire).toBe(false);
  });

  it("nudges the shot inside the club's spread cone on the release tick", () => {
    const bot = botAt(0, 0);
    (bot as unknown as { chargeHeld: number }).chargeHeld = BOT_CHARGE_RELEASE;
    // A random that returns 1 puts the spread at the positive edge of the cone.
    const spread = intentFor(bot, { x: 20, z: 0 }, () => 1).aimDelta;
    const centred = intentFor(bot, { x: 20, z: 0 }, () => 0.5).aimDelta;
    expect(spread).toBeGreaterThan(centred);
  });

  it("is deterministic for a fixed seed", () => {
    const a = botAt(0, 0);
    const b = botAt(0, 0);
    (a as unknown as { chargeHeld: number }).chargeHeld = BOT_CHARGE_RELEASE;
    (b as unknown as { chargeHeld: number }).chargeHeld = BOT_CHARGE_RELEASE;
    expect(intentFor(a, { x: 20, z: 0 }, mulberry32(7)).aimDelta).toBe(
      intentFor(b, { x: 20, z: 0 }, mulberry32(7)).aimDelta,
    );
  });

  it("never asks to change club", () => {
    expect(intentFor(botAt(0, 0), { x: 20, z: 0 }).selectClub).toBeNull();
  });
});
