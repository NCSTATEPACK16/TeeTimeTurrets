import { describe, expect, it } from "vitest";
import { GROUND_WARP_GLSL, WARP_MAX_M, WARP_OCTAVES, groundWarp } from "./groundWarp";

/**
 * Smoke check for the ground's edge warp: bounded, smooth, repeatable, and actually varying.
 * A warp that jumps would tear the fairway edge; one that is constant would do nothing.
 */
describe("ground warp", () => {
  const out = { x: 0, z: 0 };
  const near = { x: 0, z: 0 };

  it("stays within its stated bound and uses most of it", () => {
    let peak = 0;
    for (let i = 0; i < 20000; i++) {
      groundWarp(-600 + (i % 200) * 6.13, -500 + Math.floor(i / 200) * 9.71, out);
      peak = Math.max(peak, Math.abs(out.x), Math.abs(out.z));
    }
    expect(peak).toBeLessThanOrEqual(WARP_MAX_M);
    expect(peak).toBeGreaterThan(WARP_MAX_M * 0.6);
  });

  it("is smooth: a centimetre's step moves it by well under a centimetre", () => {
    let worst = 0;
    for (let i = 0; i < 5000; i++) {
      const x = -300 + i * 0.731;
      const z = 120 - i * 0.377;
      groundWarp(x, z, out);
      groundWarp(x + 0.01, z + 0.01, near);
      worst = Math.max(worst, Math.abs(out.x - near.x), Math.abs(out.z - near.z));
    }
    expect(worst).toBeLessThan(0.006);
  });

  it("is the same answer twice, and crosses lattice cells without a seam at negative coordinates", () => {
    groundWarp(-18.999, -6.999, out);
    groundWarp(-19.001, -7.001, near);
    expect(Math.abs(out.x - near.x)).toBeLessThan(0.01);
    groundWarp(123.4, -56.7, out);
    groundWarp(123.4, -56.7, near);
    expect(near).toEqual(out);
  });

  it("writes the same constants into the shader", () => {
    for (const octave of WARP_OCTAVES) {
      expect(GROUND_WARP_GLSL).toContain(`p / ${octave.cellM.toFixed(4)}`);
      expect(GROUND_WARP_GLSL).toContain(`* ${octave.amplitudeM.toFixed(4)};`);
    }
    expect(GROUND_WARP_GLSL).toContain("0x85ebca6bu");
  });
});
