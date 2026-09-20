import { describe, expect, it } from "vitest";
import { ClubType, CLUB_STATS } from "../physics/Ballistics";
import { ScriptedInputSource } from "../input/ScriptedInputSource";
import type { ScriptedStep } from "../input/ScriptedInputSource";
import { neutralIntent } from "../input/InputSource";
import { BOT_CHARGE_RELEASE, BOT_STANDOFF } from "./bot";
import { fixedHoleSpec } from "./course";
import { CART_COLLIDER } from "./entities/Cart";
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
    const sim = await Sim.create(fixedHoleSpec(), { botCount: 1 });

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
    const by = sim.terrain.heightAt(bx, pz) + CART_COLLIDER.groundOffset;
    bot.position.x = bx;
    bot.position.y = by;
    bot.position.z = pz;
    bot.heading = Math.PI; // barrel toward the player (-x)
    botRig.body.setTranslation({ x: bx, y: by, z: pz }, true);

    const startAmmo = bot.ammo;
    const startHp = player.health.hp;

    // The player never touches a control; the bot does everything on its own. Track the lowest HP
    // seen rather than the final value: a bot this effective drives the player to zero inside the
    // window, and `revive()` then refills the bar, so the final reading can be full again. What
    // survives a respawn is `strokesTaken`, which spans the match by design.
    let minHp = player.health.hp;
    for (let i = 0; i < seconds(15); i++) {
      sim.step(neutralIntent());
      minHp = Math.min(minHp, player.health.hp);
    }

    expect(bot.ammo).toBeLessThan(startAmmo); // the bot actually fired
    expect(minHp).toBeLessThan(startHp); // and its shots connected
    expect(player.strokesTaken).toBeGreaterThan(0);
  });

  it("advances the hit-event epoch each step and resets the buffer", async () => {
    const sim = await Sim.create(fixedHoleSpec(), { botCount: 0 });
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
    const sim = await Sim.create(fixedHoleSpec(), { botCount: 1 });
    for (let i = 0; i < seconds(1); i++) sim.step(neutralIntent());

    const player = sim.cart;
    const bot = sim.bots[0]!;
    const rigs = (sim as unknown as { rigs: RigLike[] }).rigs;
    const botRig = rigs.find((r) => r.cart === bot)!;
    const bx = player.position.x + BOT_STANDOFF + 1;
    const by = sim.terrain.heightAt(bx, player.position.z) + CART_COLLIDER.groundOffset;
    bot.position.x = bx;
    bot.position.y = by;
    bot.position.z = player.position.z;
    bot.heading = Math.PI;
    botRig.body.setTranslation({ x: bx, y: by, z: player.position.z }, true);

    // Player never fires; the bot does all the shooting.
    let playerEvents = 0;
    for (let i = 0; i < seconds(15); i++) {
      sim.step(neutralIntent());
      playerEvents += sim.hitEventCount;
    }

    expect(player.strokesTaken, "the bot never landed a hit, so the test proves nothing").toBeGreaterThan(0);
    expect(playerEvents).toBe(0); // none of the bot's hits are the player's markers
  });

  it("the putter's shot comes back to cart height around the standoff distance", async () => {
    // Guards the club-and-standoff pairing directly: a driver's shot is still 5 m up here, so a
    // regression that re-armed bots with a lofted club fails this even without a live bot.
    const sim = await Sim.create(fixedHoleSpec(), { botCount: 0 });

    // Fire the putter over the bonnet at the bot's release charge. Derive the hold from the club's
    // own charge time so this tracks a putter re-tune instead of silently drifting to full charge:
    // holding `chargeSeconds * BOT_CHARGE_RELEASE` reaches exactly the fraction the bot lets go at.
    const holdSeconds = CLUB_STATS[ClubType.Putter].chargeSeconds * BOT_CHARGE_RELEASE;
    const script: ScriptedStep[] = [
      { ticks: 2, intent: { selectClub: ClubType.Putter } },
      { ticks: seconds(holdSeconds), intent: { fire: true } },
      { ticks: 2, intent: {} },
    ];
    const src = new ScriptedInputSource(script);
    const warm = script.reduce((a, b) => a + b.ticks, 0);
    for (let i = 0; i < warm; i++) {
      sim.step(src.sample());
      src.endTick();
    }

    const from = { ...sim.cart.position };
    let hitAtStandoff = false;
    for (let tick = 0; tick < seconds(6); tick++) {
      sim.step();
      for (let i = 0; i < POOL_SIZE; i++) {
        const flat = i * POOL_TRANSFORM_STRIDE;
        if (sim.currentPoolTransforms[flat + 7] !== 1) continue;
        const x = sim.currentPoolTransforms[flat]!;
        const y = sim.currentPoolTransforms[flat + 1]!;
        const z = sim.currentPoolTransforms[flat + 2]!;
        const d = Math.hypot(x - from.x, z - from.z);
        const h = y - sim.terrain.heightAt(x, z);
        // Cart-height band, near the standoff: this is a shot that would strike a cart parked there.
        if (h > 0.2 && h < 1.3 && d > BOT_STANDOFF - 1.5 && d < BOT_STANDOFF + 1.5) {
          hitAtStandoff = true;
        }
        break;
      }
    }
    expect(hitAtStandoff).toBe(true);
  });
});
