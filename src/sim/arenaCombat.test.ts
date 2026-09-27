import { describe, expect, it } from "vitest";
import { CLUB_STATS, ClubType } from "../physics/Ballistics";
import { ScriptedInputSource } from "../input/ScriptedInputSource";
import type { ScriptedStep } from "../input/ScriptedInputSource";
import { neutralIntent } from "./intent";
import { BOT_FIRE_RANGE, BOT_STANDOFF } from "./bot";
import { solveShot } from "./aimSolver";
import { fixedHoleSpec } from "./course";
import { arenaFromHole } from "./arena";
import { CART_COLLIDER, CART_HULL } from "./entities/Cart";
import type { Cart } from "./entities/Cart";
import { POOL_SIZE } from "./entities/BallPool";
import { POOL_TRANSFORM_STRIDE, Sim } from "./world";

/**
 * The bot arena is only a game if a bot can actually hurt the player -- otherwise the match clock
 * runs out on an untouched health bar and every result is a draw. It could not, and for a measured
 * reason: bots fired the lofted driver from a 12 m standoff, so every shot sailed clean over the
 * target. The fix is the club-and-standoff pairing in `bot.ts` / `world.ts`, and this is the test
 * that would have caught the original bug -- it drives the real bot AI through the real Rapier
 * world rather than hand-feeding intents, per `TEST-AND-SPEC-PITFALLS.md` §1.
 */

const TPS = 60;
const seconds = (n: number): number => Math.round(n * TPS);

/** The internal rig shape this test reaches for, to stand a bot next to the player. */
interface RigLike {
  cart: Cart;
  body: { setTranslation(v: { x: number; y: number; z: number }, wake: boolean): void };
}

describe("arena combat is winnable", () => {
  it("a bot lands hits on the player it is standing off from", async () => {
    const sim = await Sim.create(arenaFromHole(fixedHoleSpec()), { botCount: 1 });

    // Let the player cart settle on the terrain, holding neutral.
    for (let i = 0; i < seconds(1); i++) sim.step(neutralIntent());

    const player = sim.cart;
    const bot = sim.bots[0]!;
    const rigs = (sim as unknown as { rigs: RigLike[] }).rigs;
    const botRig = rigs.find((r) => r.cart === bot)!;

    // Stand the bot one metre outside its standoff, facing the player, so the engagement starts
    // in range instead of after a cross-course drive. The bot closes to `BOT_STANDOFF` and fires
    // from there; nothing else about the match is scripted.
    const px = player.position.x;
    const pz = player.position.z;
    const bx = px + BOT_STANDOFF + 1;
    const by = sim.heightAt(bx, pz) + CART_COLLIDER.groundOffset;
    bot.position.x = bx;
    bot.position.y = by;
    bot.position.z = pz;
    bot.heading = Math.PI; // barrel toward the player (-x)
    botRig.body.setTranslation({ x: bx, y: by, z: pz }, true);

    const startAmmo = bot.ammo;
    const startHp = player.health.hp;

    // The player never touches a control; the bot does everything on its own. Track the lowest HP
    // seen rather than the final value: a bot this effective drives the player to zero inside the
    // window, and `revive()` then refills the bar, so the final reading can be full again.
    // Shots are counted as ticks the bot's ammo fell, not read off the final count: a bucket or the
    // bot's own landed balls can refill it mid-run.
    let minHp = player.health.hp;
    let shots = 0;
    let lastAmmo = startAmmo;
    for (let i = 0; i < seconds(15); i++) {
      sim.step(neutralIntent());
      minHp = Math.min(minHp, player.health.hp);
      if (bot.ammo < lastAmmo) shots += 1;
      lastAmmo = bot.ammo;
    }

    expect(shots).toBeGreaterThan(0); // the bot actually fired
    expect(minHp).toBeLessThan(startHp); // and its shots connected
  });

  it("advances the hit-event epoch each step and resets the buffer", async () => {
    const sim = await Sim.create(arenaFromHole(fixedHoleSpec()), { botCount: 0 });
    let last = sim.hitEventEpoch;
    for (let i = 0; i < 10; i++) {
      sim.step(neutralIntent());
      expect(sim.hitEventEpoch).toBe(last + 1); // exactly one bump per live step
      last = sim.hitEventEpoch;
      expect(sim.hitEventCount).toBe(0); // nothing hit anything, so the buffer is empty
    }
  });

  it("does not attribute a bot's hits on the player to the player's hit markers", async () => {
    // The buffer is the *player's* combat feedback: a bot pounding the player must leave it empty,
    // the same rule that keeps a bot's hit off the player's accuracy. This reuses the reliable
    // engagement above (a bot standing off the player and firing); the positive side -- a player
    // ball recording an event with its impact position -- is asserted in `combat.test.ts`.
    const sim = await Sim.create(arenaFromHole(fixedHoleSpec()), { botCount: 1 });
    for (let i = 0; i < seconds(1); i++) sim.step(neutralIntent());

    const player = sim.cart;
    const bot = sim.bots[0]!;
    const rigs = (sim as unknown as { rigs: RigLike[] }).rigs;
    const botRig = rigs.find((r) => r.cart === bot)!;
    const bx = player.position.x + BOT_STANDOFF + 1;
    const by = sim.heightAt(bx, player.position.z) + CART_COLLIDER.groundOffset;
    bot.position.x = bx;
    bot.position.y = by;
    bot.position.z = player.position.z;
    bot.heading = Math.PI;
    botRig.body.setTranslation({ x: bx, y: by, z: player.position.z }, true);

    // Player never fires; the bot does all the shooting.
    let playerEvents = 0;
    let minHp = player.health.hp;
    for (let i = 0; i < seconds(15); i++) {
      sim.step(neutralIntent());
      playerEvents += sim.hitEventCount;
      minHp = Math.min(minHp, player.health.hp);
    }

    expect(minHp, "the bot never landed a hit, so the test proves nothing").toBeLessThan(player.health.max);
    expect(playerEvents).toBe(0); // none of the bot's hits are the player's markers
  });

  it("a bot 25 m off opens fire with the pistol instead of driving in to point-blank first", async () => {
    const sim = await Sim.create(arenaFromHole(fixedHoleSpec()), { botCount: 1 });
    for (let i = 0; i < seconds(1); i++) sim.step(neutralIntent());

    const player = sim.cart;
    const bot = sim.bots[0]!;
    const rigs = (sim as unknown as { rigs: RigLike[] }).rigs;
    const botRig = rigs.find((r) => r.cart === bot)!;
    const bx = player.position.x + 25;
    const by = sim.heightAt(bx, player.position.z) + CART_COLLIDER.groundOffset;
    bot.position.x = bx;
    bot.position.y = by;
    bot.position.z = player.position.z;
    bot.heading = Math.PI;
    botRig.body.setTranslation({ x: bx, y: by, z: player.position.z }, true);

    const startAmmo = bot.ammo;
    let firedFrom = -1;
    for (let i = 0; i < seconds(1.5) && firedFrom < 0; i++) {
      sim.step(neutralIntent());
      if (bot.ammo < startAmmo) firedFrom = Math.hypot(bot.position.x - player.position.x, bot.position.z - player.position.z);
    }
    expect(firedFrom, "the bot never fired").toBeGreaterThan(0);
    expect(firedFrom).toBeGreaterThan(15);
  });

});

/** Fires `club` over the bonnet at `charge` and reports its height above the ground `range` out. */
async function heightAtRange(club: ClubType, charge: number, range: number): Promise<number> {
  const sim = await Sim.create(arenaFromHole(fixedHoleSpec()), { botCount: 0 });
  const chargeTicks = Math.max(1, Math.round(charge * CLUB_STATS[club].chargeSeconds * TPS));
  const script: ScriptedStep[] = [
    { ticks: 2, intent: { selectClub: club } },
    { ticks: chargeTicks, intent: { fire: true } },
    { ticks: 1, intent: {} },
  ];
  const src = new ScriptedInputSource(script);
  const warm = script.reduce((a, b) => a + b.ticks, 0);
  for (let i = 0; i < warm; i++) {
    sim.step(src.sample());
    src.endTick();
  }

  const from = { ...sim.cart.position };
  for (let tick = 0; tick < seconds(4); tick++) {
    sim.step();
    for (let i = 0; i < POOL_SIZE; i++) {
      const flat = i * POOL_TRANSFORM_STRIDE;
      if (sim.currentPoolTransforms[flat + 7] !== 1) continue;
      const x = sim.currentPoolTransforms[flat]!;
      const z = sim.currentPoolTransforms[flat + 2]!;
      if (Math.hypot(x - from.x, z - from.z) >= range) return sim.currentPoolTransforms[flat + 1]! - sim.heightAt(x, z);
    }
  }
  return Number.NaN;
}

describe("the shot solver against the real world", () => {
  it.each([BOT_STANDOFF, 25, BOT_FIRE_RANGE])(
    "any putter shot a bot takes from %s m is at cart height there",
    async (range) => {
      // A flatness guard more than a solver test: the putter is flat enough that almost any charge
      // hits across the whole fire band, which is what makes it a pistol.
      const h = await heightAtRange(ClubType.Putter, solveShot(ClubType.Putter, range), range);
      expect(h, "the ball never got that far").not.toBeNaN();
      expect(h).toBeGreaterThan(0.2);
      expect(h).toBeLessThan(CART_HULL.height);
    },
  );

  it.each([20, 30])("an iron at the charge solved for %s m arrives at mid-hull height there", async (range) => {
    // The iron is where charge decides range, so this is the test the table is right. It is
    // integrated over flat ground with constants copied from world.ts; this checks the copy flies.
    const h = await heightAtRange(ClubType.Iron, solveShot(ClubType.Iron, range), range);
    expect(h, "the ball never got that far").not.toBeNaN();
    expect(Math.abs(h - CART_HULL.height / 2)).toBeLessThan(0.7);
  });
});
