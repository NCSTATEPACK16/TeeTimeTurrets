import { describe, expect, it } from "vitest";
import { CLUB_STATS, ClubType } from "../physics/Ballistics";
import { ScriptedInputSource } from "../input/ScriptedInputSource";
import type { ScriptedStep } from "../input/ScriptedInputSource";
import { neutralIntent } from "./intent";
import { BOT_CHARGE_RELEASE, BOT_FIRE_RANGE, BOT_STANDOFF } from "./bot";
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

  it("the putter's shot is at cart height across the whole range a bot fires from", async () => {
    // Guards the club-and-range pairing directly: a regression that re-armed bots with a lofted
    // club, or lobbed the putter again, leaves the ball above a cart or in the dirt somewhere in
    // this band, and fails this without a live bot.
    const sim = await Sim.create(arenaFromHole(fixedHoleSpec()), { botCount: 0 });

    // Fire the putter over the bonnet at the bot's release charge.
    const releaseTicks = Math.ceil((BOT_CHARGE_RELEASE * CLUB_STATS[ClubType.Putter].chargeSeconds) / (1 / TPS));
    const script: ScriptedStep[] = [
      { ticks: 2, intent: { selectClub: ClubType.Putter } },
      { ticks: releaseTicks, intent: { fire: true } },
      { ticks: 1, intent: {} },
    ];
    const src = new ScriptedInputSource(script);
    const warm = script.reduce((a, b) => a + b.ticks, 0);
    for (let i = 0; i < warm; i++) {
      sim.step(src.sample());
      src.endTick();
    }

    const from = { ...sim.cart.position };
    let samples = 0;
    for (let tick = 0; tick < seconds(3); tick++) {
      sim.step();
      for (let i = 0; i < POOL_SIZE; i++) {
        const flat = i * POOL_TRANSFORM_STRIDE;
        if (sim.currentPoolTransforms[flat + 7] !== 1) continue;
        const x = sim.currentPoolTransforms[flat]!;
        const y = sim.currentPoolTransforms[flat + 1]!;
        const z = sim.currentPoolTransforms[flat + 2]!;
        const d = Math.hypot(x - from.x, z - from.z);
        if (d < BOT_STANDOFF || d > BOT_FIRE_RANGE) continue;
        const h = y - sim.heightAt(x, z);
        expect(h, `${d.toFixed(1)} m out`).toBeGreaterThan(0.2);
        expect(h, `${d.toFixed(1)} m out`).toBeLessThan(CART_HULL.height);
        samples++;
      }
    }
    expect(samples, "the ball never crossed the fire band").toBeGreaterThan(5);
  });
});
