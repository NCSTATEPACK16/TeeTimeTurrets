import { describe, expect, it } from "vitest";
import { ClubType } from "../physics/Ballistics";
import { ScriptedInputSource } from "../input/ScriptedInputSource";
import type { ScriptedStep } from "../input/ScriptedInputSource";
import { neutralIntent } from "./intent";
import { fixedHoleSpec } from "./course";
import { arenaFromHole } from "./arena";
import { CART_COLLIDER } from "./entities/Cart";
import type { Cart } from "./entities/Cart";
import { Sim } from "./world";

/**
 * The muzzle sits 2.6 m up, on the roof pedestal, and the cart's movement capsule tops out at
 * 1.9 m. A flat putter shot at a cart a few metres away used to pass over the capsule and hit
 * nothing -- the gun could not hit the thing it was pointed at. The hull hitbox is the fix.
 */

const TPS = 60;
const seconds = (n: number): number => Math.round(n * TPS);

interface RigLike {
  cart: Cart;
  body: { setTranslation(v: { x: number; y: number; z: number }, wake: boolean): void };
}

/** Stands `cart` `distance` metres ahead of the player's turret. Teleported once, never pinned. */
function standAhead(sim: Sim, cart: Cart, distance: number): void {
  const rigs = (sim as unknown as { rigs: RigLike[] }).rigs;
  const rig = rigs.find((r) => r.cart === cart)!;
  const yaw = sim.cart.turretYaw;
  const x = sim.cart.position.x + Math.cos(yaw) * distance;
  const z = sim.cart.position.z + Math.sin(yaw) * distance;
  const y = sim.heightAt(x, z) + CART_COLLIDER.groundOffset;
  cart.position.x = x;
  cart.position.y = y;
  cart.position.z = z;
  rig.body.setTranslation({ x, y, z }, true);
}

function run(sim: Sim, script: ScriptedStep[]): void {
  const src = new ScriptedInputSource(script);
  const total = script.reduce((a, b) => a + b.ticks, 0);
  for (let i = 0; i < total; i++) {
    sim.step(src.sample());
    src.endTick();
  }
}

/** Selects the putter and holds the trigger to full charge, without releasing. */
function chargePutter(sim: Sim): void {
  run(sim, [
    { ticks: 2, intent: { selectClub: ClubType.Putter } },
    { ticks: seconds(1), intent: { fire: true } },
  ]);
}

describe("hull hitbox", () => {
  it("a flat putter shot hits a cart standing 4 m ahead", async () => {
    const sim = await Sim.create(arenaFromHole(fixedHoleSpec()), { botCount: 1 });
    for (let i = 0; i < seconds(1); i++) sim.step(neutralIntent());

    const bot = sim.bots[0]!;
    chargePutter(sim);
    // Placed at the release, so the bot has no time to drive out of the line of fire first.
    standAhead(sim, bot, 4);
    const before = bot.health.hp;
    const ammo = sim.cart.ammo;

    run(sim, [{ ticks: seconds(0.5), intent: {} }]);

    expect(sim.cart.ammo, "the player's shot never left the muzzle").toBe(ammo - 1);
    expect(bot.health.hp).toBeLessThan(before);
  });
});
