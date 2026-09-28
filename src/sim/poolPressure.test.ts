import { describe, expect, it } from "vitest";
import { authoredCourse } from "./authoredCourse";
import { fixedHoleSpec } from "./course";
import { buildCourseWorld } from "./courseWorld";
import { arenaFromCourse, arenaFromHole } from "./arena";
import { ARENA_BOTS } from "./matchConfig";
import { neutralIntent } from "./intent";
import { POOL_SIZE } from "./entities/BallPool";
import { Sim } from "./world";

/**
 * The player's trigger is never silently refused, on the course that ships, in a full 4v4.
 *
 * Measured at the end of Stage 1: with the player firing every 0.75 s for 60 s, all 32 pooled
 * balls were in the air on most ticks and half the player's shots put nothing up. Here the
 * player fires on the same schedule, and a `dry` event while the magazine still had rounds is a
 * refusal.
 */

const COURSE_SEED = 2026;
const TPS = 60;

describe("a full 4v4 and a 32-ball pool", () => {
  it("never refuses the player's shot while the player has ammo", async () => {
    const world = buildCourseWorld(authoredCourse(COURSE_SEED), COURSE_SEED);
    const sim = await Sim.create(arenaFromCourse(world), { botCount: ARENA_BOTS });

    const intent = neutralIntent();
    const from = sim.events.total;
    let refused = 0;
    let shots = 0;
    let saturatedTicks = 0;
    for (let tick = 0; tick < 60 * TPS; tick++) {
      // Hold the trigger for 6 ticks, then release: one putter shot every 45 ticks (0.75 s).
      intent.fire = tick % 45 < 6;
      const hadAmmo = sim.cart.ammo > 0 && !sim.cart.dead;
      const before = sim.events.total;
      sim.step(intent);
      for (let s = before; s < sim.events.total; s++) {
        const e = sim.events.at(s)!;
        if (e.actor !== 0) continue;
        if (e.kind === "shot") shots++;
        if (e.kind === "dry" && hadAmmo) refused++;
      }
      const flying = (sim as unknown as { ballPool: { all: readonly { state: string }[] } }).ballPool.all.filter(
        (b) => b.state === "flying",
      ).length;
      if (flying === POOL_SIZE) saturatedTicks++;
    }
    expect(sim.events.total).toBeGreaterThan(from);
    // The premise: the pool really is under pressure, or a zero below proves nothing.
    expect(saturatedTicks, "the pool never filled, so this cannot show a refusal").toBeGreaterThan(0);
    expect(shots).toBeGreaterThan(40);
    expect(refused).toBe(0);
  }, 180_000);

  it("takes a bot's ball out of the air for the player when every ball is airborne", async () => {
    const sim = await Sim.create(arenaFromHole(fixedHoleSpec()), { botCount: 1 });
    for (let i = 0; i < 30; i++) sim.step(neutralIntent());
    // Every body a bot's shot, 200 m up: none can touch down in the few ticks this takes.
    const pool = (sim as unknown as {
      ballPool: { acquire(firedBy: number): { body: { setTranslation(v: object, w: boolean): void } } | null };
    }).ballPool;
    for (let i = 0; i < POOL_SIZE; i++) pool.acquire(1)!.body.setTranslation({ x: i, y: 200, z: 0 }, true);

    const intent = neutralIntent();
    const from = sim.events.total;
    intent.fire = true;
    for (let i = 0; i < 8; i++) sim.step(intent);
    intent.fire = false;
    sim.step(intent);

    const mine: string[] = [];
    for (let s = from; s < sim.events.total; s++) {
      const e = sim.events.at(s)!;
      if (e.actor === 0 && (e.kind === "shot" || e.kind === "dry")) mine.push(e.kind);
    }
    expect(mine).toEqual(["shot"]);
  });
});
