import { describe, expect, it } from "vitest";
import { arenaFromHole, courseArenaZone, coursePickupSites } from "./arena";
import type { ArenaGround } from "./arena";
import { ArenaZone, ZONE_HARD_LIMIT_M, ZONE_HOLE_INDICES } from "./arenaZone";
import { authoredCourse } from "./authoredCourse";
import { AUTHORED_CLUBHOUSE } from "./authoredLayout";
import { fixedHoleSpec } from "./course";
import { toCourseFrame } from "./courseLayout";
import { buildCourseWorld } from "./courseWorld";
import { neutralIntent } from "./intent";
import { ARENA_MAX_HEALTH } from "./matchConfig";
import { createTeamPads } from "./spawn";
import { Sim } from "./world";

/**
 * The arena zone (#52), against the plan's tests: the six holes and the clubhouse pads are inside
 * it, a cart outside drains on schedule and is held 30 m out, and a bot never drives out after its
 * target. The course checks use the shipped course; the match checks stand on one hole with a
 * hand-made zone, where the geometry can be chosen to make each rule bite.
 */

/** A square zone, for the single-hole arena. */
function square(minX: number, minZ: number, maxX: number, maxZ: number): ArenaZone {
  return new ArenaZone([
    { x: minX, z: minZ },
    { x: maxX, z: minZ },
    { x: maxX, z: maxZ },
    { x: minX, z: maxZ },
  ]);
}

/** The fixed hole (tee at (-45, 0), cup at (45, 8)) with this zone. The player opens on the tee. */
function holeWith(zone: ArenaZone | null): ArenaGround {
  return { ...arenaFromHole(fixedHoleSpec()), zone };
}

const edge = { x: 0, z: 0 };

describe("the arena zone on the shipped course", () => {
  const world = buildCourseWorld(authoredCourse(2026), 2026);
  const zone = courseArenaZone(world);

  it("holds every tee and cup of the six holes, the clubhouse and both teams' pads, and nothing far off", () => {
    const p = { x: 0, z: 0 };
    for (const hole of world.holes) {
      for (const point of [hole.spec.tee, hole.spec.cup]) {
        toCourseFrame(hole.placement, point.x, point.z, p);
        // The control is in the same loop: a tee or cup of a hole outside the six is outside it.
        expect(zone.contains(p.x, p.z)).toBe(ZONE_HOLE_INDICES.includes(hole.spec.index));
      }
    }
    expect(zone.contains(AUTHORED_CLUBHOUSE.x, AUTHORED_CLUBHOUSE.z)).toBe(true);
    const pads = createTeamPads(AUTHORED_CLUBHOUSE, (x, z) => world.terrain.heightAt(x, z));
    expect(pads.flat().length).toBe(8);
    for (const slot of pads.flat()) expect(zone.contains(slot.x, slot.z)).toBe(true);
    // And the pickups placed for it: all inside, depot included.
    for (const site of coursePickupSites(world)) expect(zone.contains(site.x, site.z)).toBe(true);
  });
});

describe("a cart outside the zone", () => {
  it("is warned at once and loses a point of health every 2 s", async () => {
    // A zone round the cup's end: the player, on the tee, starts 25 m outside it.
    const sim = await Sim.create(holeWith(square(-20, -40, 80, 40)), { botCount: 0 });
    const idle = neutralIntent();
    sim.step(idle);
    expect(sim.cart.outOfZoneS).toBeGreaterThan(0);
    const hpAt = (ticks: number): number => {
      while (sim.match.remaining > 0 && Math.round(sim.cart.outOfZoneS * 60) < ticks) sim.step(idle);
      return sim.cart.health.hp;
    };
    expect(hpAt(119)).toBe(ARENA_MAX_HEALTH);
    expect(hpAt(120)).toBe(ARENA_MAX_HEALTH - 1);
    expect(hpAt(239)).toBe(ARENA_MAX_HEALTH - 1);
    expect(hpAt(240)).toBe(ARENA_MAX_HEALTH - 2);
    sim.dispose();
  });

  it("cannot drive more than 30 m out", async () => {
    // A small zone round the tee; the player drives straight off it toward the cup, 90 m away.
    const zone = square(-51, -6, -39, 6);
    const sim = await Sim.create(holeWith(zone), { botCount: 0 });
    const intent = neutralIntent();
    intent.throttle = 1;
    let worst = 0;
    for (let i = 0; i < 600; i++) {
      sim.step(intent);
      worst = Math.max(worst, zone.distanceOutside(sim.cart.position.x, sim.cart.position.z, edge));
    }
    expect(worst).toBeLessThanOrEqual(ZONE_HARD_LIMIT_M + 1e-6);
    // The premise: it got there, so the clamp is what stopped it.
    expect(worst).toBeGreaterThan(ZONE_HARD_LIMIT_M - 0.5);
    sim.dispose();
  });
});

describe("a bot", () => {
  /** The furthest the bot gets out of `zone` in 15 s, hunting a player parked 25 m outside it. */
  async function botStrays(groundZone: ArenaZone | null, zone: ArenaZone): Promise<number> {
    const sim = await Sim.create(holeWith(groundZone), { botCount: 1 });
    const idle = neutralIntent();
    let worst = 0;
    for (let i = 0; i < 900; i++) {
      sim.step(idle);
      const bot = sim.bots[0]!;
      if (!bot.dead) worst = Math.max(worst, zone.distanceOutside(bot.position.x, bot.position.z, edge));
    }
    sim.dispose();
    return worst;
  }

  it("never drives out of the zone after a target standing outside it", async () => {
    const zone = square(-20, -40, 80, 40);
    expect(await botStrays(zone, zone)).toBeLessThan(2);
    // The control: with no zone in the ground the same bot does follow the player out.
    expect(await botStrays(null, zone)).toBeGreaterThan(5);
  });
});
