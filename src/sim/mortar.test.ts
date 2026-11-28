import { afterEach, describe, expect, it } from "vitest";
import { arenaFromHole } from "./arena";
import { fixedHoleSpec } from "./course";
import type { HoleSpec } from "./course";
import { neutralIntent } from "./intent";
import type { PlayerIntent } from "./intent";
import {
  MORTAR_BALLS,
  MORTAR_DROP_TICKS,
  MORTAR_SPLASH_M,
  MORTAR_SPREAD_M,
  MORTAR_TELEGRAPH_TICKS,
} from "./mortar";
import type { Barrage } from "./mortar";
import type { PooledBall } from "./entities/BallPool";
import { Sim } from "./world";

/**
 * Stage 3.5c's Mulligan Mortar, against
 * `docs/superpowers/specs/2026-11-27-mortar-and-capture-flags-design.md` §3, on a single-hole arena
 * so a `Sim` builds in milliseconds.
 *
 * Rigs alternate teams: the player (0) and rig 2 are team 0; rigs 1, 3 and 5 are team 1.
 *
 * Two private seams are used, each named where it is. `killCart` scores a kill without
 * choreographing three real ones; what combat does to reach it is `combat.test.ts`'s subject, and
 * the streak is what is under test here. `placeRig` holds a cart still where a case needs it.
 */

interface Seams {
  killCart(cart: unknown, victim: number, killer: number): void;
  placeRig(rig: unknown, spawn: { x: number; y: number; z: number; heading: number }): void;
  readonly rigs: { cart: Sim["cart"] }[];
  readonly barrages: Barrage[];
  readonly ballPool: { readonly all: readonly PooledBall[] };
}

const seams = (sim: Sim): Seams => sim as unknown as Seams;
const sims: Sim[] = [];

async function arena(bots: number, spec: HoleSpec = fixedHoleSpec()): Promise<Sim> {
  const sim = await Sim.create(arenaFromHole(spec), { botCount: bots });
  sims.push(sim);
  return sim;
}

afterEach(() => {
  for (const sim of sims.splice(0)) sim.dispose();
});

function kill(sim: Sim, victim: number, killer: number): void {
  const s = seams(sim);
  s.killCart(s.rigs[victim]!.cart, victim, killer);
}

function kindsOf(sim: Sim, from: number): string[] {
  const out: string[] = [];
  for (let i = from; i < sim.events.total; i++) out.push(sim.events.at(i)!.kind);
  return out;
}

/** Steps once with the mortar called, then returns the barrage it started. */
function call(sim: Sim): Barrage {
  const intent: PlayerIntent = { ...neutralIntent(), callMortar: true };
  sim.step(intent);
  const barrage = seams(sim).barrages.find((b) => b.active);
  if (!barrage) throw new Error("the call started no barrage");
  return barrage;
}

describe("earning it", () => {
  it("is earned on the third kill of a streak, not the second", async () => {
    const sim = await arena(5);
    kill(sim, 1, 0);
    kill(sim, 3, 0);
    expect(sim.cart.mortars).toBe(0);
    const from = sim.events.total;
    kill(sim, 5, 0);
    expect(sim.cart.mortars).toBe(1);
    expect(kindsOf(sim, from)).toEqual(["kill", "mortarEarned"]);
  });

  it("starts the streak over when the cart dies between kills", async () => {
    const sim = await arena(5);
    kill(sim, 1, 0);
    kill(sim, 3, 0);
    kill(sim, 0, 1);
    sim.cart.dead = false;
    kill(sim, 5, 0);
    expect(sim.cart.killStreak).toBe(1);
    expect(sim.cart.mortars).toBe(0);
  });

  it("keeps a held mortar through a death, and a rematch clears it", async () => {
    const sim = await arena(5);
    kill(sim, 1, 0);
    kill(sim, 3, 0);
    kill(sim, 5, 0);
    kill(sim, 0, 1);
    expect(sim.cart.killStreak).toBe(0);
    expect(sim.cart.mortars).toBe(1);
    sim.reset();
    expect(sim.cart.mortars).toBe(0);
  });
});

describe("the barrage", () => {
  it("drops six balls inside the ring, the first touching down two seconds after the call", async () => {
    const sim = await arena(1);
    sim.cart.mortars = 1;
    const barrage = call(sim);
    expect(sim.cart.mortars).toBe(0);

    const balls = seams(sim).ballPool.all;
    // Ticks since the call, counted here: tick 1 is the step after the one that called it.
    const landedAt = new Map<PooledBall, number>();
    const landedWhere = new Map<PooledBall, [number, number]>();
    for (let t = 1; t <= MORTAR_TELEGRAPH_TICKS + 120; t++) {
      sim.step();
      for (const ball of balls) {
        if (!ball.mortar || !ball.touchedDown || landedAt.has(ball)) continue;
        landedAt.set(ball, t);
        // Where it came down, before it bounces and rolls.
        landedWhere.set(ball, [ball.position[0]!, ball.position[2]!]);
      }
    }
    expect(landedAt.size).toBe(MORTAR_BALLS);
    // Two seconds to within two ticks: the pool calls a ball grounded within two radii of the
    // grass, a hair before it reaches it.
    const first = Math.min(...landedAt.values());
    expect(Math.abs(first - MORTAR_TELEGRAPH_TICKS)).toBeLessThanOrEqual(2);
    for (const [x, z] of landedWhere.values()) {
      const d = Math.hypot(x - barrage.targetX, z - barrage.targetZ);
      expect(d).toBeLessThanOrEqual(MORTAR_SPREAD_M + 0.5);
    }
    expect(MORTAR_DROP_TICKS).toBeLessThan(MORTAR_TELEGRAPH_TICKS);
  });

  it("draws the same six points from the same seed, and others from another", async () => {
    // Offsets from the target, not the points: another seed is another hole, whose own target
    // moves the points even with no randomness at all, and that must not pass for a seeded spread.
    const points = async (spec: HoleSpec): Promise<number[]> => {
      const sim = await arena(1, spec);
      sim.cart.mortars = 1;
      const barrage = call(sim);
      // Rounded to a millimetre: (target + offset) - target is not the offset to the last bit, and
      // that rounding differs between targets, which would make two equal spreads look unequal.
      return Array.from(barrage.impacts, (v, i) => Math.round((v - (i % 2 === 0 ? barrage.targetX : barrage.targetZ)) * 1000));
    };
    const a = await points(fixedHoleSpec());
    const b = await points(fixedHoleSpec());
    const c = await points({ ...fixedHoleSpec(), seed: fixedHoleSpec().seed + 1 });
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
  });
});

/**
 * Holds rig `index` `MORTAR_SPLASH_M - 1` metres beside one of the barrage's impact points that has
 * no other within reach, so exactly one ball can splash it and none can hit it directly (the hull
 * is 0.9 m round). Returns a step function that re-pins it before each tick.
 */
function pinBeside(sim: Sim, barrage: Barrage, index: number): () => void {
  const s = seams(sim);
  let at = -1;
  for (let i = 0; i < MORTAR_BALLS && at < 0; i++) {
    const x = barrage.impacts[i * 2]! + (MORTAR_SPLASH_M - 1);
    const z = barrage.impacts[i * 2 + 1]!;
    let others = 0;
    for (let j = 0; j < MORTAR_BALLS; j++) {
      if (j !== i && Math.hypot(barrage.impacts[j * 2]! - x, barrage.impacts[j * 2 + 1]! - z) <= MORTAR_SPLASH_M + 1) others++;
    }
    if (others === 0) at = i;
  }
  if (at < 0) throw new Error("no impact point stands clear of the others on this seed");
  const spot = { x: barrage.impacts[at * 2]! + (MORTAR_SPLASH_M - 1), z: barrage.impacts[at * 2 + 1]! };
  const rig = s.rigs[index]!;
  return () => {
    s.placeRig(rig, { x: spot.x, y: sim.heightAt(spot.x, spot.z), z: spot.z, heading: 0 });
    rig.cart.speed = 0;
    // Every bot, not just this one: a landed mortar ball is ammo, and a bot that picks one up would
    // shoot the pinned cart and muddle what the barrage did.
    for (const bot of sim.bots) bot.ammo = 0;
  };
}

/** Calls a barrage, pins rig `index` beside one ball, and plays the barrage out. */
async function splashOn(index: number, setUp: (cart: Sim["cart"]) => void) {
  const sim = await arena(2);
  sim.cart.mortars = 1;
  for (const bot of sim.bots) bot.ammo = 0;
  const barrage = call(sim);
  const pin = pinBeside(sim, barrage, index);
  const victim = seams(sim).rigs[index]!.cart;
  setUp(victim);
  const from = sim.events.total;
  for (let t = 0; t < MORTAR_TELEGRAPH_TICKS + 90; t++) {
    pin();
    sim.step();
  }
  const events = [];
  for (let i = from; i < sim.events.total; i++) {
    const e = sim.events.at(i)!;
    if (e.target === index) events.push({ kind: e.kind, actor: e.actor });
  }
  return { sim, victim, events };
}

describe("the splash", () => {
  it("costs an enemy beside a ball one point, and a kill by it is the caller's", async () => {
    const { sim, victim, events } = await splashOn(1, (cart) => {
      cart.health.hp = 1;
    });
    expect(events).toContainEqual({ kind: "hit", actor: 0 });
    expect(events).toContainEqual({ kind: "kill", actor: 0 });
    expect(victim.dead).toBe(true);
    expect(sim.match.pointsFor(0)).toBe(1);
  });

  it("spares a teammate", async () => {
    const { victim, events } = await splashOn(2, (cart) => {
      cart.health.hp = 1;
    });
    expect(events).toEqual([]);
    expect(victim.dead).toBe(false);
  });

  it("spares a cart under spawn protection", async () => {
    const { victim, events } = await splashOn(1, (cart) => {
      cart.health.hp = 1;
      cart.protectedFor = 999;
    });
    expect(events).toEqual([]);
    expect(victim.health.hp).toBe(1);
  });

  it("is taken whole by a shield plate", async () => {
    const { victim, events } = await splashOn(1, (cart) => {
      cart.health.hp = 1;
      cart.shield = 1;
      cart.shieldDecayIn = 999;
    });
    expect(events).toEqual([{ kind: "plateBroken", actor: 0 }]);
    expect(victim.health.hp).toBe(1);
    expect(victim.shield).toBe(0);
  });
});
