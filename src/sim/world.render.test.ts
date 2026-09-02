import { describe, expect, it } from "vitest";
import { generateCourse } from "./course";
import { POOL_TRANSFORM_STRIDE, Sim, SwingMode, TRANSFORM_STRIDE } from "./world";
import { POOL_SIZE } from "./entities/BallPool";
import { PARTS_PER_TARGET, TARGET_PART_SHAPES } from "./entities/Target";
import { neutralIntent } from "../input/InputSource";

/**
 * The render snapshot buffers, tested through Sim's public surface only. The renderer is a pure
 * consumer of these, so if they are wrong every pixel downstream is wrong, and nothing in
 * src/render/** is reachable from the node environment to catch it.
 */
const holes = generateCourse(2026, 2).holes;

describe("target transform snapshots", () => {
  it("is sized for every part of every target", async () => {
    const sim = await Sim.create(holes[0]!);
    expect(sim.targets.length).toBeGreaterThan(0);
    expect(sim.targetPartCount).toBe(sim.targets.length * PARTS_PER_TARGET);
    expect(sim.currentTargetTransforms.length).toBe(sim.targetPartCount * TRANSFORM_STRIDE);
    expect(sim.previousTargetTransforms.length).toBe(sim.currentTargetTransforms.length);
  });

  it("matches the live body transforms after a step", async () => {
    const sim = await Sim.create(holes[0]!);
    sim.step();

    const buffer = sim.currentTargetTransforms;
    let i = 0;
    for (const target of sim.targets) {
      for (const part of target.parts) {
        const t = part.body.translation();
        const r = part.body.rotation();
        expect(buffer[i]).toBeCloseTo(t.x, 4);
        expect(buffer[i + 1]).toBeCloseTo(t.y, 4);
        expect(buffer[i + 2]).toBeCloseTo(t.z, 4);
        expect(buffer[i + 3]).toBeCloseTo(r.x, 4);
        expect(buffer[i + 4]).toBeCloseTo(r.y, 4);
        expect(buffer[i + 5]).toBeCloseTo(r.z, 4);
        expect(buffer[i + 6]).toBeCloseTo(r.w, 4);
        i += TRANSFORM_STRIDE;
      }
    }
  });

  it("does not allocate a new buffer per tick", async () => {
    const sim = await Sim.create(holes[0]!);
    const seen = new Set<Float32Array>();
    for (let n = 0; n < 8; n++) {
      sim.step();
      seen.add(sim.currentTargetTransforms);
      seen.add(sim.previousTargetTransforms);
    }
    // Double-buffered: exactly two arrays, swapped, never reallocated.
    expect(seen.size).toBe(2);
  });

  it("seeds previous from current on reset so a rebuild is not lerped through", async () => {
    const sim = await Sim.create(holes[0]!);
    for (let n = 0; n < 20; n++) sim.step();
    sim.reset();
    expect(Array.from(sim.previousTargetTransforms)).toEqual(
      Array.from(sim.currentTargetTransforms),
    );
  });

  it("resizes for a new hole's targets", async () => {
    const sim = await Sim.create(holes[0]!);
    sim.loadHole(holes[1]!);
    expect(sim.targetPartCount).toBe(sim.targets.length * PARTS_PER_TARGET);
    expect(sim.currentTargetTransforms.length).toBe(sim.targetPartCount * TRANSFORM_STRIDE);
    expect(sim.previousTargetTransforms.length).toBe(sim.currentTargetTransforms.length);
  });
});

describe("target part shapes", () => {
  it("exposes one shape per rig part, with positive dimensions", () => {
    expect(TARGET_PART_SHAPES).toHaveLength(PARTS_PER_TARGET);
    for (const shape of TARGET_PART_SHAPES) {
      expect(shape.radius).toBeGreaterThan(0);
      expect(shape.halfHeight).toBeGreaterThan(0);
    }
  });

  it("agrees with the colliders actually built from it", async () => {
    const sim = await Sim.create(holes[0]!);
    const target = sim.targets[0]!;
    expect(target.parts.map((p) => p.name)).toEqual(TARGET_PART_SHAPES.map((s) => s.name));
  });
});

describe("pooled ball snapshots", () => {
  it("is sized for the whole pool and starts inactive", async () => {
    const sim = await Sim.create(generateCourse(2026, 1).holes[0]!);
    expect(sim.currentPoolTransforms.length).toBe(POOL_SIZE * POOL_TRANSFORM_STRIDE);
    expect(sim.previousPoolTransforms.length).toBe(sim.currentPoolTransforms.length);
    for (let i = 0; i < POOL_SIZE; i++) {
      expect(sim.currentPoolTransforms[i * POOL_TRANSFORM_STRIDE + 7]).toBe(0);
    }
  });

  it("marks a slot active once a cart-mode shot spawns a ball", async () => {
    const sim = await Sim.create(generateCourse(2026, 1).holes[0]!);
    sim.mode = SwingMode.Cart;
    const intent = neutralIntent();
    intent.fire = true;
    sim.step(intent);
    intent.fire = false;
    for (let n = 0; n < 30; n++) sim.step(intent);

    const active = countActive(sim.currentPoolTransforms);
    expect(active).toBeGreaterThan(0);
  });

  it("does not allocate a new pool buffer per tick", async () => {
    const sim = await Sim.create(generateCourse(2026, 1).holes[0]!);
    const seen = new Set<Float32Array>();
    for (let n = 0; n < 8; n++) {
      sim.step();
      seen.add(sim.currentPoolTransforms);
      seen.add(sim.previousPoolTransforms);
    }
    expect(seen.size).toBe(2);
  });

  it("clears every slot when the pool is released for a new hole", async () => {
    const course = generateCourse(2026, 2).holes;
    const sim = await Sim.create(course[0]!);
    sim.mode = SwingMode.Cart;
    const intent = neutralIntent();
    intent.fire = true;
    sim.step(intent);
    intent.fire = false;
    for (let n = 0; n < 30; n++) sim.step(intent);
    expect(countActive(sim.currentPoolTransforms)).toBeGreaterThan(0);

    sim.loadHole(course[1]!);
    expect(countActive(sim.currentPoolTransforms)).toBe(0);
  });
});

function countActive(buffer: Float32Array): number {
  let active = 0;
  for (let i = 0; i < POOL_SIZE; i++) {
    if (buffer[i * POOL_TRANSFORM_STRIDE + 7] === 1) active++;
  }
  return active;
}
