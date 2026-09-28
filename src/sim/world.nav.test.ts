import { describe, expect, it } from "vitest";
import { AUTHORED_CLUBHOUSE } from "./authoredLayout";
import { createArenaZone } from "./arenaZone";
import { createCartPaths } from "./cartPaths";
import { CART_COLLIDER } from "./entities/Cart";
import { toCourseFrame } from "./courseGeometry";
import { SurfaceId } from "./surfaces";
import { miniCourse } from "./testing/miniCourse";
import { Sim } from "./world";

/** A bot's route on the real Rapier world: round hole 18's pond to an enemy across it. */

async function pondChase(withZone: boolean): Promise<{ wet: number; closedTo: number; startGap: number }> {
  const course = miniCourse(18, 8, 2026);
  const zone = createArenaZone(course.holes, AUTHORED_CLUBHOUSE);
  const paths = createCartPaths(course.holes, AUTHORED_CLUBHOUSE);
  const ground = withZone ? { ...course.ground, zone, paths } : course.ground;
  const sim = await Sim.create(ground, { botCount: 1 });

  const hole = course.holes.find((h) => h.spec.index === 17)!;
  const pond = hole.spec.water[0]!.points;
  let cx = 0;
  let cz = 0;
  for (const p of pond) {
    cx += p.x / pond.length;
    cz += p.z / pond.length;
  }
  let reach = 0;
  for (const p of pond) reach = Math.max(reach, Math.hypot(p.x - cx, p.z - cz));
  const a = { x: 0, z: 0 };
  const b = { x: 0, z: 0 };
  toCourseFrame(hole.placement, cx, cz - reach - 25, a);
  toCourseFrame(hole.placement, cx, cz + reach + 25, b);

  const bot = sim.bots[0]!;
  const player = sim.cart;
  for (const [cart, at] of [[bot, a], [player, b]] as const) {
    cart.position.x = at.x;
    cart.position.z = at.z;
    cart.position.y = sim.heightAt(at.x, at.z) + CART_COLLIDER.groundOffset;
    cart.lastSafePosition.x = at.x;
    cart.lastSafePosition.y = cart.position.y;
    cart.lastSafePosition.z = at.z;
  }
  bot.heading = Math.atan2(b.z - a.z, b.x - a.x);
  const startGap = Math.hypot(b.x - a.x, b.z - a.z);

  let wet = 0;
  for (let i = 0; i < 25 * 60; i++) {
    sim.step();
    if (sim.surfaces.surfaceAt(bot.position.x, bot.position.z) === SurfaceId.Water) wet++;
    // The player sits still; a splash puts a cart back where it was dry, so count entries too.
    if (bot.wasInWater) wet++;
  }
  const closedTo = Math.hypot(bot.position.x - player.position.x, bot.position.z - player.position.z);
  sim.dispose();
  return { wet, closedTo, startGap };
}

describe("bots on the nav graph", () => {
  it("drive round a pond to an enemy across it, never into it", async () => {
    const run = await pondChase(true);
    expect(run.wet).toBe(0);
    expect(run.closedTo).toBeLessThan(40);
  });

  it("drive into it without one, which is why the graph exists", async () => {
    const run = await pondChase(false);
    expect(run.wet).toBeGreaterThan(0);
  });
});
