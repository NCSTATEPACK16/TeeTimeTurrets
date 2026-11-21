import { describe, expect, it } from "vitest";
import { authoredCourse } from "../sim/authoredCourse";
import { buildCourseWorld } from "../sim/courseWorld";
import {
  RIPPLE_LIFE_S,
  RIPPLE_SLOTS,
  RippleRing,
  SHORE_STRIDE,
  SPILL_FREEBOARD_M,
  buildWaterMesh,
  spillLevel,
} from "./waterMesh";

/**
 * Smoke check for the water surface on the shipped course. The complaint it holds is "the water
 * floats above the ground": a sheet whose edge hangs above lower ground. So the assertion is
 * about the bank: beyond every shoreline point, the ground is not lower than the water.
 */
describe("water mesh on the shipped course", () => {
  const world = buildCourseWorld(authoredCourse(2026), 2026);
  const heightAt = (x: number, z: number): number => world.terrain.heightAt(x, z);
  const placedPonds = world.holes.reduce((n, hole) => n + hole.spec.water.length, 0);
  const mesh = buildWaterMesh(world.holes, heightAt, () => 0x4a91aa);

  it("draws every placed pond, each at a level its basin can keep", () => {
    expect(placedPonds).toBeGreaterThan(0);
    expect(mesh.ponds).toBe(placedPonds);
    expect(mesh.info.length).toBe(placedPonds);
    for (const pond of mesh.info) {
      expect(pond.level).toBeLessThanOrEqual(pond.nominal);
      expect(pond.level).toBeLessThanOrEqual(pond.spill - SPILL_FREEBOARD_M + 1e-6);
      expect(pond.level).toBeGreaterThan(pond.floor);
    }
    // The ponds do not all share one level any more: the ground around them does not.
    expect(new Set(mesh.info.map((p) => p.level.toFixed(2))).size).toBeGreaterThan(2);
    const levels = new Set(mesh.info.map((p) => Math.fround(p.level)));
    for (let i = 1; i < mesh.positions.length; i += 3) expect(levels.has(mesh.positions[i]!)).toBe(true);
  });

  it("meets the bank: the ground just past every shoreline is not lower than the water", () => {
    // A sheet cut off short of the bank has a shoreline over lower ground. The tolerance is a few
    // centimetres of lattice error where a shoreline crosses a ridge, and 1 in 200 points may use it.
    let hanging = 0;
    const points = mesh.shore.length / SHORE_STRIDE;
    expect(points).toBeGreaterThan(200);
    for (let i = 0; i < mesh.shore.length; i += SHORE_STRIDE) {
      const beyond = heightAt(mesh.shore[i]! + mesh.shore[i + 2]! * 0.8, mesh.shore[i + 1]! + mesh.shore[i + 3]! * 0.8);
      if (mesh.shore[i + 4]! - beyond > 0.12) hanging++;
    }
    expect(hanging / points).toBeLessThan(0.005);
  });

  it("searched far enough: a window twice as wide changes no level by more than a quarter metre", () => {
    // A smaller window can only find a lower spill, never a higher one, so it errs on the safe
    // side: it cannot make water that spills. What it can do is make ponds needlessly low, by
    // calling the edge of the window an outlet. A wider window finding more than a quarter metre
    // of extra height would mean this one is too small.
    const wider = buildWaterMesh(world.holes, heightAt, () => 0, 48);
    expect(wider.info.length).toBe(mesh.info.length);
    wider.info.forEach((pond, i) => {
      const gain = pond.level - mesh.info[i]!.level;
      // A wider window moves the sampling lattice, which moves a spill by a few millimetres.
      expect(gain, `pond ${i}`).toBeGreaterThanOrEqual(-0.02);
      expect(gain, `pond ${i}`).toBeLessThan(0.25);
    });
  });

  it("bakes a shore and deep water into the depth", () => {
    let shore = 0;
    let deep = 0;
    for (const d of mesh.depth) {
      if (d > 0 && d < 0.25) shore++;
      if (d > 1.2) deep++;
    }
    expect(shore).toBeGreaterThan(50);
    expect(deep).toBeGreaterThan(50);
  });
});

describe("spill level", () => {
  // A 7 x 7 grid: a bowl in the middle at 0, a rim at 1, and one notch in the rim at 0.4.
  const side = 7;
  const bowl = (): Float32Array => {
    const g = new Float32Array(side * side).fill(2);
    for (let j = 1; j <= 5; j++) for (let i = 1; i <= 5; i++) g[j * side + i] = 1;
    for (let j = 2; j <= 4; j++) for (let i = 2; i <= 4; i++) g[j * side + i] = 0;
    return g;
  };

  it("is the lowest point of the rim", () => {
    const g = bowl();
    expect(spillLevel(g, side, side - 1, 3 * side + 3)).toBe(2);
    // Cut a channel from the bowl out through the rim to the grid's edge: the water spills at the
    // channel's highest point, however high the rest of the rim is.
    g[3 * side + 5] = 0.4;
    g[3 * side + 6] = 0.4;
    expect(spillLevel(g, side, side - 1, 3 * side + 3)).toBeCloseTo(0.4, 5);
    g[3 * side + 5] = 0.3;
    g[3 * side + 6] = 0.3;
    expect(spillLevel(g, side, side - 1, 3 * side + 3)).toBeCloseTo(0.3, 5);
  });
});

describe("ripple ring", () => {
  it("keeps the last eight splashes and lets them expire", () => {
    const ring = new RippleRing();
    for (let i = 0; i < RIPPLE_SLOTS + 3; i++) ring.push(i, 0, 0);
    expect(ring.live(0.1)).toBe(RIPPLE_SLOTS);
    // The three oldest were overwritten by the three newest.
    expect(ring.data[0]).toBe(RIPPLE_SLOTS);
    expect(ring.live(RIPPLE_LIFE_S + 0.01)).toBe(0);
  });
});
