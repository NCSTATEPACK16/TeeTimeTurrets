import { describe, expect, it } from "vitest";
import { authoredCourse } from "../sim/authoredCourse";
import { buildCourseWorld } from "../sim/courseWorld";
import { toCourseFrame } from "../sim/courseLayout";
import { placeTeeSigns, TEE_SIGN_BACK_M } from "./teeSigns";

/** Smoke check for the tee-sign pass (`docs/art/specs/tee-sign.md`). */
describe("tee signs", () => {
  const world = buildCourseWorld(authoredCourse(2026), 2026);
  const signs = placeTeeSigns(world.holes);

  it("puts one sign 6 m behind each of the 18 tees, facing the tee", () => {
    expect(signs).toHaveLength(18);
    const tee = { x: 0, z: 0 };
    for (const [i, hole] of world.holes.entries()) {
      toCourseFrame(hole.placement, hole.spec.tee.x, hole.spec.tee.z, tee);
      const s = signs[i]!;
      expect(Math.hypot(s.x - tee.x, s.z - tee.z)).toBeCloseTo(TEE_SIGN_BACK_M, 3);
      // The face (local +z after yaw) points from the sign at the tee.
      const fx = Math.sin(s.yaw);
      const fz = Math.cos(s.yaw);
      expect((tee.x - s.x) * fx + (tee.z - s.z) * fz).toBeCloseTo(TEE_SIGN_BACK_M, 3);
    }
  });

  it("prints each hole's own number and par", () => {
    const seven = world.holes.find((h) => h.spec.index === 6)!;
    const sign = signs.find((s) => s.hole === 6)!;
    expect(sign.lines[0]).toBe("HOLE 7");
    expect(sign.lines[1]).toBe(`PAR ${seven.spec.par}`);
    expect(sign.lines[2]).toMatch(/^\d{2,3} YDS$/);
  });
});
