import { describe, expect, it } from "vitest";
import { createZoneFromPoints, zoneSignedDistance } from "./arenaZone";
import type { ArenaZone } from "./arenaZone";
import { miniCourse } from "./testing/miniCourse";
import { Sim } from "./world";


/** The arena zone as the tick applies it, on the real Rapier world. */

function squareAround(x: number, z: number, half: number, pad: number): ArenaZone {
  return createZoneFromPoints(
    [
      { x: x - half, z: z - half },
      { x: x + half, z: z - half },
      { x: x + half, z: z + half },
      { x: x - half, z: z + half },
    ],
    pad,
  );
}

async function simWithZone(botCount: number, zoneAt: (sim: Sim) => ArenaZone): Promise<Sim> {
  const course = miniCourse(6, 8, 2026);
  // The zone is known only once the carts are down, so it is built against a first Sim's spawns.
  const probe = await Sim.create(course.ground, { botCount });
  const zone = zoneAt(probe);
  probe.dispose();
  return Sim.create({ ...course.ground, zone }, { botCount });
}

describe("out of bounds", () => {
  it("drains a point every two seconds from a cart parked outside the zone", async () => {
    const sim = await simWithZone(0, (s) => squareAround(s.cart.position.x + 200, s.cart.position.z, 20, 10));
    const max = sim.cart.health.max;
    expect(zoneSignedDistance(sim.zone!, sim.cart.position.x, sim.cart.position.z)).toBeGreaterThan(0);

    for (let i = 0; i < 119; i++) sim.step();
    expect(sim.cart.outOfBoundsFor).toBeGreaterThan(1.9);
    expect(sim.cart.health.hp).toBe(max);
    sim.step();
    expect(sim.cart.health.hp).toBe(max - 1);
    for (let i = 0; i < 240; i++) sim.step();
    expect(sim.cart.health.hp).toBe(max - 3);
    // Held at the reach past the stakes, not left 200 m out.
    expect(zoneSignedDistance(sim.zone!, sim.cart.position.x, sim.cart.position.z)).toBeLessThan(31);
    sim.dispose();
  });

  it("drains nothing inside the zone", async () => {
    const sim = await simWithZone(0, (s) => squareAround(s.cart.position.x, s.cart.position.z, 20, 10));
    const max = sim.cart.health.max;
    for (let i = 0; i < 360; i++) sim.step();
    expect(sim.cart.health.hp).toBe(max);
    expect(sim.cart.outOfBoundsFor).toBe(0);
    sim.dispose();
  });

  it("never sends a bot out of the zone after an enemy outside it", async () => {
    const sim = await simWithZone(1, (s) => {
      const bot = s.bots[0]!;
      return squareAround(bot.position.x, bot.position.z, 15, 10);
    });
    expect(zoneSignedDistance(sim.zone!, sim.cart.position.x, sim.cart.position.z)).toBeGreaterThan(20);
    let worst = -Infinity;
    for (let i = 0; i < 20 * 60; i++) {
      sim.step();
      const bot = sim.bots[0]!;
      worst = Math.max(worst, zoneSignedDistance(sim.zone!, bot.position.x, bot.position.z));
    }
    expect(worst).toBeLessThan(3);
    sim.dispose();
  });
});
