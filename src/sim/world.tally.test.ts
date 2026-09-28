import { describe, expect, it } from "vitest";
import { neutralIntent } from "./intent";
import type { PlayerIntent } from "./intent";
import { fixedHoleSpec } from "./course";
import { arenaFromHole } from "./arena";
import { CART_COLLIDER } from "./entities/Cart";
import type { Cart } from "./entities/Cart";
import { teamOf } from "./matchConfig";
import { Sim } from "./world";

/** The player's match tally, which the results screen turns into a score, coins and XP. */

interface RigLike {
  cart: Cart;
  body: { setTranslation(v: { x: number; y: number; z: number }, wake: boolean): void };
}

describe("Sim.tally", () => {
  it("counts the player's damage and kills exactly as the event log records them, and resets for a rematch", async () => {
    const sim = await Sim.create(arenaFromHole(fixedHoleSpec()), { botCount: 1 });
    for (let i = 0; i < 60; i++) sim.step(neutralIntent());
    const player = sim.cart;
    const bot = sim.bots[0]!;
    const rig = (sim as unknown as { rigs: RigLike[] }).rigs.find((r) => r.cart === bot)!;
    // A sitting target 9 m down the player's barrel.
    const bx = player.position.x + Math.cos(player.turretYaw) * 9;
    const bz = player.position.z + Math.sin(player.turretYaw) * 9;
    const by = sim.heightAt(bx, bz) + CART_COLLIDER.groundOffset;
    Object.assign(bot.position, { x: bx, y: by, z: bz });
    rig.body.setTranslation({ x: bx, y: by, z: bz }, true);

    const start = sim.events.head;
    const hold: PlayerIntent = { ...neutralIntent(), fire: true };
    for (let shot = 0; shot < 20; shot++) {
      for (let i = 0; i < 12; i++) sim.step(hold);
      for (let i = 0; i < 40; i++) sim.step(neutralIntent());
    }
    let damage = 0;
    let kills = 0;
    for (let seq = sim.events.firstUnread(start); seq < sim.events.head; seq++) {
      const e = sim.events.at(seq)!;
      if (e.kind === "hit" && e.actor === 0 && teamOf(e.target) !== teamOf(0)) damage += e.amount;
      if (e.kind === "kill" && e.actor === 0) kills++;
    }
    expect(damage).toBeGreaterThan(0);
    expect(sim.tally.damage).toBe(damage);
    expect(sim.tally.kills).toBe(kills);

    sim.reset();
    expect(sim.tally).toEqual({ kills: 0, assists: 0, damage: 0, pickups: 0 });
    sim.dispose();
  });
});
