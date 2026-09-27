import { describe, expect, it } from "vitest";
import { fixedHoleSpec } from "./course";
import { arenaFromHole } from "./arena";
import { neutralIntent } from "./intent";
import type { BotMind } from "./bot";
import { CART_COLLIDER } from "./entities/Cart";
import { Sim } from "./world";

const TPS = 60;

interface RigLike {
  mind: BotMind | null;
}

interface RigBody {
  body: { setTranslation(v: { x: number; y: number; z: number }, wake: boolean): void };
}

describe("bot minds in the world", () => {
  it("a bot with an empty magazine goes and gets more", async () => {
    const sim = await Sim.create(arenaFromHole(fixedHoleSpec()), { botCount: 1 });
    const bot = sim.bots[0]!;
    bot.ammo = 0;

    // Stand the bot on the far side of the player from the bucket, so fighting the player never
    // takes it past the bucket: it refills only if it goes looking. Teleported once.
    const bucket = sim.pickups[0]!.position;
    const p = sim.cart.position;
    const away = Math.atan2(p.z - bucket.z, p.x - bucket.x);
    const x = p.x + Math.cos(away) * 20;
    const z = p.z + Math.sin(away) * 20;
    const y = sim.heightAt(x, z) + CART_COLLIDER.groundOffset;
    bot.position.x = x;
    bot.position.y = y;
    bot.position.z = z;
    bot.heading = away + Math.PI;
    (sim as unknown as { rigs: RigBody[] }).rigs[1]!.body.setTranslation({ x, y, z }, true);

    let refilled = false;
    for (let tick = 0; tick < 30 * TPS && !refilled; tick++) {
      sim.step(neutralIntent());
      refilled = bot.ammo > 0;
    }
    expect(refilled).toBe(true);
  }, 60_000);

  it("gives each bot its own skill, the same on every run of the same course", async () => {
    const skills = async (): Promise<number[]> => {
      const sim = await Sim.create(arenaFromHole(fixedHoleSpec()), { botCount: 4 });
      const rigs = (sim as unknown as { rigs: RigLike[] }).rigs;
      return rigs.slice(1).map((r) => r.mind!.skill);
    };
    const a = await skills();
    const b = await skills();
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
    for (const s of a) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});
