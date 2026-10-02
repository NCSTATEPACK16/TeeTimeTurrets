import { describe, expect, it } from "vitest";
import { hasLineOfSight, LOS_STEP_M } from "./lineOfSight";
import { clubhouseObstacles } from "./clubhouse";
import { PAD_OFFSET_M } from "./spawn";
import type { HeightSampler } from "./lineOfSight";

/**
 * Every case below asserts a clear sight line and a blocked one that differ by a single variable.
 * A constant-returning implementation therefore fails every test rather than half of them, which
 * is the defect TEST-AND-SPEC-PITFALLS section 1 catalogues: a negative assertion that passes
 * because nothing was computed at all.
 */

/** Ground at y = 0 everywhere. */
const flat: HeightSampler = { heightAt: () => 0 };

/** A wall of height `h` occupying x in [x0, x1]; ground elsewhere. */
function ridge(h: number, x0: number, x1: number): HeightSampler {
  return { heightAt: (x) => (x >= x0 && x <= x1 ? h : 0) };
}

describe("terrain between the endpoints", () => {
  it("sees across flat ground and not through a ridge on the same line", () => {
    expect(hasLineOfSight(flat, 0, 2, 0, 100, 2, 0)).toBe(true);
    expect(hasLineOfSight(ridge(10, 40, 60), 0, 2, 0, 100, 2, 0)).toBe(false);
  });

  it("sees over a ridge once both endpoints are above it", () => {
    const hill = ridge(10, 40, 60);
    expect(hasLineOfSight(hill, 0, 2, 0, 100, 2, 0)).toBe(false);
    expect(hasLineOfSight(hill, 0, 20, 0, 100, 20, 0)).toBe(true);
  });

  it("ignores terrain that is not between the endpoints", () => {
    // The same ridge, once beyond the target and once between the two.
    expect(hasLineOfSight(ridge(10, 140, 160), 0, 2, 0, 100, 2, 0)).toBe(true);
    expect(hasLineOfSight(ridge(10, 40, 60), 0, 2, 0, 100, 2, 0)).toBe(false);
  });

  it("follows the ray's slope rather than testing a flat height", () => {
    // A 6 m ridge at the midpoint. Level at y = 2 the ray is under it; climbing to y = 40 the
    // ray passes over the same ridge at the same place.
    const hill = ridge(6, 48, 52);
    expect(hasLineOfSight(hill, 0, 2, 0, 100, 2, 0)).toBe(false);
    expect(hasLineOfSight(hill, 0, 2, 0, 100, 40, 0)).toBe(true);
  });

  it("works along z as well as x", () => {
    const acrossZ: HeightSampler = { heightAt: (_x, z) => (z >= 40 && z <= 60 ? 10 : 0) };
    expect(hasLineOfSight(acrossZ, 0, 2, 0, 0, 2, 100)).toBe(false);
    expect(hasLineOfSight(acrossZ, 0, 2, 0, 100, 2, 0)).toBe(true);
  });
});

describe("degenerate spans", () => {
  it("reports adjacent points as visible but still tests a real span", () => {
    // Inside one step there is nothing to sample, so even a wall cannot block.
    const wall = ridge(50, -1000, 1000);
    expect(hasLineOfSight(wall, 0, 2, 0, LOS_STEP_M / 2, 2, 0)).toBe(true);
    // Past a step, the same wall does block -- proving the short-span case is a real branch
    // rather than the function always returning true.
    expect(hasLineOfSight(wall, 0, 2, 0, 100, 2, 0)).toBe(false);
  });
});

describe("grazing", () => {
  it("treats terrain exactly at the ray height as visible, and just above it as blocked", () => {
    expect(hasLineOfSight({ heightAt: () => 2 }, 0, 2, 0, 100, 2, 0)).toBe(true);
    expect(hasLineOfSight({ heightAt: () => 2.01 }, 0, 2, 0, 100, 2, 0)).toBe(false);
  });
});

describe("buildings between the endpoints", () => {
  // The complex on flat ground at the origin. The pad rows are at x = +/-25; the clubhouse spans
  // z -7..7, the food cart stands at z 16, and nothing stands at z 10 between the rows.
  const obstacles = clubhouseObstacles({ x: 0, z: 0 }, () => 0);

  it("the clubhouse blocks a sight line straight across between the spawn rows", () => {
    expect(hasLineOfSight(flat, -PAD_OFFSET_M, 1, 0, PAD_OFFSET_M, 1, 0)).toBe(true);
    expect(hasLineOfSight(flat, -PAD_OFFSET_M, 1, 0, PAD_OFFSET_M, 1, 0, obstacles)).toBe(false);
  });

  it("a sight line past the clubhouse corner is clear", () => {
    expect(hasLineOfSight(flat, -PAD_OFFSET_M, 1, 10, PAD_OFFSET_M, 1, 10, obstacles)).toBe(true);
  });
});
