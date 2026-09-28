import { describe, expect, it } from "vitest";
import { miniCourse } from "./testing/miniCourse";
import { Sim } from "./world";
import { ScriptedInputSource } from "../input/ScriptedInputSource";

/** A cart path as the tick applies it, on the real Rapier world. */

async function distanceDriven(withPath: boolean): Promise<number> {
  const course = miniCourse(6, 8, 2026);
  const probe = await Sim.create(course.ground, { botCount: 0 });
  const start = { ...probe.cart.position };
  const heading = probe.cart.heading;
  probe.dispose();
  const path = {
    kind: "clubhouse" as const,
    points: [
      { x: start.x, z: start.z },
      { x: start.x + Math.cos(heading) * 200, z: start.z + Math.sin(heading) * 200 },
    ],
  };
  const sim = await Sim.create({ ...course.ground, paths: withPath ? [path] : [] }, { botCount: 0 });
  const source = new ScriptedInputSource([{ ticks: 4 * 60, intent: { throttle: 1 } }]);
  for (let i = 0; i < 4 * 60; i++) {
    sim.step(source.sample());
    source.endTick();
  }
  const d = Math.hypot(sim.cart.position.x - start.x, sim.cart.position.z - start.z);
  sim.dispose();
  return d;
}

describe("cart paths in the tick", () => {
  it("carry a cart further in the same time than the turf beside them", async () => {
    const on = await distanceDriven(true);
    const off = await distanceDriven(false);
    expect(on).toBeGreaterThan(off * 1.04);
  });
});
