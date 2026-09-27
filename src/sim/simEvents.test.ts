import { describe, expect, it } from "vitest";
import { ClubType } from "../physics/Ballistics";
import { neutralIntent } from "./intent";
import { BOT_STANDOFF } from "./bot";
import { fixedHoleSpec } from "./course";
import { arenaFromHole } from "./arena";
import { CART_COLLIDER } from "./entities/Cart";
import type { Cart } from "./entities/Cart";
import type { SimEvent } from "./events";
import { Sim } from "./world";

/**
 * `Sim.events` from the outside: the real sim, the real bot, the real Rapier contacts. The log's
 * own mechanics are `events.test.ts`; this is whether the sim writes the right thing into it.
 */

const seconds = (n: number): number => Math.round(n * 60);

interface RigLike {
  cart: Cart;
  index: number;
  body: { setTranslation(v: { x: number; y: number; z: number }, wake: boolean): void };
}

/** Every event written from `from` on, copied out, since the log recycles its slots. */
function eventsSince(sim: Sim, from: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let s = from; s < sim.events.total; s++) out.push({ ...sim.events.at(s)! });
  return out;
}

/** One bot parked `BOT_STANDOFF + 1` m east of the player, facing it, so it opens fire. */
async function botFacingPlayer(): Promise<{ sim: Sim; bot: RigLike }> {
  const sim = await Sim.create(arenaFromHole(fixedHoleSpec()), { botCount: 1 });
  for (let i = 0; i < seconds(1); i++) sim.step(neutralIntent());
  const player = sim.cart;
  const rigs = (sim as unknown as { rigs: RigLike[] }).rigs;
  const bot = rigs[1]!;
  const bx = player.position.x + BOT_STANDOFF + 1;
  const by = sim.heightAt(bx, player.position.z) + CART_COLLIDER.groundOffset;
  bot.cart.position.x = bx;
  bot.cart.position.y = by;
  bot.cart.position.z = player.position.z;
  bot.cart.heading = Math.PI;
  bot.body.setTranslation({ x: bx, y: by, z: player.position.z }, true);
  return { sim, bot };
}

describe("Sim.events", () => {
  it("records a bot's hit on the player as the bot's, with the damage and where it landed", async () => {
    const { sim, bot } = await botFacingPlayer();
    const from = sim.events.total;
    let minHp = sim.cart.health.hp;
    for (let i = 0; i < seconds(15) && minHp === sim.cart.health.max; i++) {
      sim.step(neutralIntent());
      minHp = Math.min(minHp, sim.cart.health.hp);
    }
    expect(minHp, "the bot never landed a hit, so this proves nothing").toBeLessThan(sim.cart.health.max);

    const hits = eventsSince(sim, from).filter((e) => e.kind === "hit");
    expect(hits.length).toBeGreaterThan(0);
    const hit = hits[0]!;
    expect(hit.actor).toBe(bot.index);
    expect(hit.target).toBe(0);
    expect(hit.amount).toBeGreaterThan(0);
    // Where the ball met the cart: within a cart's reach of the player, not at the origin.
    expect(Math.hypot(hit.x - sim.cart.position.x, hit.z - sim.cart.position.z)).toBeLessThan(5);

    const shots = eventsSince(sim, from).filter((e) => e.kind === "shot" && e.actor === bot.index);
    expect(shots.length, "a hit with no shot before it").toBeGreaterThanOrEqual(hits.length);
  });

  it("writes exactly one kill for a death, charged to the victim, and it is the stroke", async () => {
    const { sim, bot } = await botFacingPlayer();
    sim.cart.health.hp = 1; // the next hit is lethal
    const from = sim.events.total;
    for (let i = 0; i < seconds(15) && !sim.cart.dead; i++) sim.step(neutralIntent());
    expect(sim.cart.dead, "the bot never killed the player, so this proves nothing").toBe(true);

    const kills = eventsSince(sim, from).filter((e) => e.kind === "kill");
    expect(kills).toHaveLength(1);
    expect(kills[0]!.actor).toBe(bot.index);
    expect(kills[0]!.target).toBe(0);
    expect(sim.match.strokesFor(0)).toBe(1);
  });

  it("writes a respawn when a dead cart comes back", async () => {
    const { sim } = await botFacingPlayer();
    sim.cart.health.hp = 1;
    for (let i = 0; i < seconds(15) && !sim.cart.dead; i++) sim.step(neutralIntent());
    expect(sim.cart.dead).toBe(true);
    const from = sim.events.total;
    for (let i = 0; i < seconds(5) && sim.cart.dead; i++) sim.step(neutralIntent());
    expect(sim.cart.dead).toBe(false);
    expect(eventsSince(sim, from).filter((e) => e.kind === "respawn" && e.actor === 0)).toHaveLength(1);
  });

  it("writes one shot for the player's trigger pull, carrying the club", async () => {
    const sim = await Sim.create(arenaFromHole(fixedHoleSpec()), { botCount: 0 });
    for (let i = 0; i < seconds(0.5); i++) sim.step(neutralIntent());
    const from = sim.events.total;
    const intent = neutralIntent();
    intent.selectClub = ClubType.Iron;
    sim.step(intent);
    intent.selectClub = null;
    intent.fire = true;
    for (let i = 0; i < seconds(1); i++) sim.step(intent);
    intent.fire = false;
    sim.step(intent);

    const shots = eventsSince(sim, from).filter((e) => e.kind === "shot");
    expect(shots).toHaveLength(1);
    expect(shots[0]!.actor).toBe(0);
    expect(shots[0]!.club).toBe(ClubType.Iron);
  });
});
