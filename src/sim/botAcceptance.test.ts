import { describe, expect, it } from "vitest";
import { authoredCourse } from "./authoredCourse";
import { buildCourseWorld } from "./courseWorld";
import { arenaFromCourse } from "./arena";
import { ARENA_BOTS } from "./matchConfig";
import { neutralIntent } from "./intent";
import { Sim } from "./world";

/**
 * Stage 1.8's acceptance bar, on the course that ships: a player who never touches a control is
 * hit at least once inside 30 s. If the bots cannot manage that against a sitting target, the
 * arena is a drive in the country.
 */

const COURSE_SEED = 2026;
const TPS = 60;

describe("bots on the shipped course", () => {
  it("land a hit on an idle player within 30 s", async () => {
    const world = buildCourseWorld(authoredCourse(COURSE_SEED), COURSE_SEED);
    const sim = await Sim.create(arenaFromCourse(world), { botCount: ARENA_BOTS });

    const intent = neutralIntent();
    let hitAt = -1;
    for (let tick = 0; tick < 30 * TPS && hitAt < 0; tick++) {
      sim.step(intent);
      if (sim.cart.health.hp < sim.cart.health.max || sim.cart.dead) hitAt = tick / TPS;
    }
    expect(hitAt, "no bot hit the idle player in 30 s").toBeGreaterThanOrEqual(0);
  }, 120_000);
});
