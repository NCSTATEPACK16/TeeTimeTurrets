import { describe, expect, it } from "vitest";
import { fixedHoleSpec } from "./course";
import { arenaFromHole } from "./arena";
import { POOL_TRANSFORM_STRIDE, Sim } from "./world";
import { POOL_SIZE } from "./entities/BallPool";
import { neutralIntent } from "./intent";

/**
 * The render snapshot buffers, tested through Sim's public surface only. The renderer is a pure
 * consumer of these, so if they are wrong every pixel downstream is wrong, and nothing in
 * src/render/** is reachable from the node environment to catch it.
 */
const ground = arenaFromHole(fixedHoleSpec());

describe("pooled ball snapshots", () => {
  it("is sized for the whole pool and starts inactive", async () => {
    const sim = await Sim.create(ground, { botCount: 0 });
    expect(sim.currentPoolTransforms.length).toBe(POOL_SIZE * POOL_TRANSFORM_STRIDE);
    expect(sim.previousPoolTransforms.length).toBe(sim.currentPoolTransforms.length);
    for (let i = 0; i < POOL_SIZE; i++) {
      expect(sim.currentPoolTransforms[i * POOL_TRANSFORM_STRIDE + 7]).toBe(0);
    }
  });

  it("marks a slot active once a cart-mode shot spawns a ball", async () => {
    const sim = await Sim.create(ground, { botCount: 0 });
    const intent = neutralIntent();
    intent.fire = true;
    sim.step(intent);
    intent.fire = false;
    for (let n = 0; n < 30; n++) sim.step(intent);

    const active = countActive(sim.currentPoolTransforms);
    expect(active).toBeGreaterThan(0);
  });

  it("does not allocate a new pool buffer per tick", async () => {
    const sim = await Sim.create(ground, { botCount: 0 });
    const seen = new Set<Float32Array>();
    for (let n = 0; n < 8; n++) {
      sim.step();
      seen.add(sim.currentPoolTransforms);
      seen.add(sim.previousPoolTransforms);
    }
    expect(seen.size).toBe(2);
  });

  it("seeds the previous transform on the tick a slot activates, so a spawning ball has no stale prior position to lerp from", async () => {
    const sim = await Sim.create(ground, { botCount: 0 });
    const intent = neutralIntent();
    intent.fire = true;
    sim.step(intent);
    intent.fire = false;
    sim.step(intent); // fires on this tick's release edge, per Cart's charge-and-release model

    let activeIndex = -1;
    for (let i = 0; i < POOL_SIZE; i++) {
      if (sim.currentPoolTransforms[i * POOL_TRANSFORM_STRIDE + 7] === 1) {
        activeIndex = i;
        break;
      }
    }
    expect(activeIndex).toBeGreaterThanOrEqual(0);

    const flat = activeIndex * POOL_TRANSFORM_STRIDE;
    // On the very tick a slot activates, its "previous" snapshot must already equal "current" --
    // otherwise interpolateTransforms lerps the ball in from wherever that slot's previous
    // occupant (or world origin, for a never-used slot) last stood.
    for (let k = 0; k < POOL_TRANSFORM_STRIDE; k++) {
      expect(sim.previousPoolTransforms[flat + k]).toBeCloseTo(sim.currentPoolTransforms[flat + k]!, 5);
    }
  });
});

function countActive(buffer: Float32Array): number {
  let active = 0;
  for (let i = 0; i < POOL_SIZE; i++) {
    if (buffer[i * POOL_TRANSFORM_STRIDE + 7] === 1) active++;
  }
  return active;
}
