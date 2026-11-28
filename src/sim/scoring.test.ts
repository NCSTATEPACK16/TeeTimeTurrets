import { describe, expect, it } from "vitest";
import { neutralIntent } from "./intent";
import { BOT_STANDOFF } from "./bot";
import { fixedHoleSpec } from "./course";
import { arenaFromHole } from "./arena";
import { CART_COLLIDER } from "./entities/Cart";
import type { Cart } from "./entities/Cart";
import { NO_KILLER, teamOf } from "./matchConfig";
import { TEAM_DRAW } from "./match";
import { ASSIST_WINDOW_TICKS, MatchTally, addXp, createEarnings, matchEarnings, xpToNext } from "./scoring";
import { Sim } from "./world";

/**
 * Stage 8 slice 1's smoke check (docs/superpowers/specs/2026-11-28-stage-8-economy-design.md §6):
 * the formulas on fixed numbers, the assist window at its edges, and a real `Sim` writing the tally
 * where it writes the log.
 */

describe("Stage 8 scoring", () => {
  it("prices a match by the formula and levels up more than once from one big match", () => {
    // Carts 0 and 2 are team 0, 1 and 3 team 1 (`teamOf` alternates).
    expect([teamOf(0), teamOf(1), teamOf(2)]).toEqual([0, 1, 0]);
    const tally = new MatchTally();
    tally.kills[0] = 3;
    tally.assists[0] = 2;
    tally.damage[0] = 17;
    tally.pickups[0] = 4;
    const won = matchEarnings(tally, 0, 0, createEarnings());
    // 300 + 80 + 170 + 60 + 250
    expect(won).toMatchObject({ score: 860, coins: 430, xp: 860, won: true });
    expect(matchEarnings(tally, 1, 0, createEarnings())).toMatchObject({ score: 610, coins: 305, won: false });
    expect(matchEarnings(tally, TEAM_DRAW, 0, createEarnings()).won).toBe(false);

    expect(xpToNext(1)).toBe(750);
    // 750 to level 2, 1000 to level 3, 100 left over.
    expect(addXp(1, 0, 1850)).toEqual({ level: 3, xp: 100 });
    expect(addXp(1, 700, 49)).toEqual({ level: 1, xp: 749 });
  });

  it("pays an assist for damage inside the 5 s window, and none outside it, to the killer or across sides", () => {
    const tally = new MatchTally();
    // Cart 2 (team 0) hits cart 1, then cart 0 (team 0) kills it 2 s later.
    tally.damaged(2, 1, 1, 0);
    tally.damaged(0, 1, 2, 60);
    tally.killed(0, 1, 120);
    expect([tally.kills[0], tally.assists[0], tally.assists[2]]).toEqual([1, 0, 1]);
    expect([tally.damage[0], tally.damage[2]]).toEqual([2, 1]);

    // A hit one tick past the window earns nothing; the edge itself still counts.
    tally.damaged(2, 3, 1, 1000);
    tally.killed(0, 3, 1000 + ASSIST_WINDOW_TICKS + 1);
    expect(tally.assists[2]).toBe(1);
    tally.damaged(2, 3, 1, 2000);
    tally.killed(0, 3, 2000 + ASSIST_WINDOW_TICKS);
    expect(tally.assists[2]).toBe(2);

    // Friendly fire is neither damage nor a claim; a death nobody caused still pays its assists.
    tally.damaged(2, 0, 5, 3000);
    expect(tally.damage[2]).toBe(2 + 1);
    tally.damaged(1, 2, 1, 4000);
    tally.killed(NO_KILLER, 2, 4010);
    expect(tally.assists[1]).toBe(1);
    expect(tally.kills[1]).toBe(0);
  });

  it("is written by the sim: a bot's kill and its damage match the log", async () => {
    const sim = await Sim.create(arenaFromHole(fixedHoleSpec()), { botCount: 1 });
    for (let i = 0; i < 60; i++) sim.step(neutralIntent());
    // Park the bot just outside its standoff, facing the player, so it opens fire.
    const rigs = (sim as unknown as { rigs: { cart: Cart; body: { setTranslation(v: object, w: boolean): void } }[] }).rigs;
    const bot = rigs[1]!;
    const bx = sim.cart.position.x + BOT_STANDOFF + 1;
    const by = sim.heightAt(bx, sim.cart.position.z) + CART_COLLIDER.groundOffset;
    bot.cart.position.x = bx;
    bot.cart.position.y = by;
    bot.cart.position.z = sim.cart.position.z;
    bot.cart.heading = Math.PI;
    bot.body.setTranslation({ x: bx, y: by, z: sim.cart.position.z }, true);
    sim.cart.health.hp = 3;

    const from = sim.events.total;
    for (let i = 0; i < 15 * 60 && !sim.cart.dead; i++) sim.step(neutralIntent());
    expect(sim.cart.dead, "the bot never killed the player, so this proves nothing").toBe(true);

    let logged = 0;
    for (let s = from; s < sim.events.total; s++) {
      const e = sim.events.at(s)!;
      if ((e.kind === "hit" || e.kind === "ram") && e.actor === 1 && e.target === 0) logged += e.amount;
    }
    expect(logged).toBeGreaterThan(0);
    expect(sim.tally.kills[1]).toBe(1);
    expect(sim.tally.damage[1]).toBe(logged);

    sim.reset();
    expect([sim.tally.kills[1], sim.tally.damage[1]]).toEqual([0, 0]);
    sim.dispose();
  });
});
