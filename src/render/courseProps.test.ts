import { describe, expect, it } from "vitest";
import { courseFlagstickPositions, deriveCoursePropPlacements } from "./courseProps";
import { authoredCourse } from "../sim/authoredCourse";
import { buildCourseWorld } from "../sim/courseWorld";
import { toCourseFrame } from "../sim/courseGeometry";

/**
 * The course dressing's *placement rule* is what matters here (there is no WebGL in the node env,
 * so how a marker looks is the Scene Gate's job): every hole gets a flagstick at its cup and its
 * tee furniture, and every prop lands inside the course bounds on the blended ground rather than at
 * the origin or off the map. Guards the arena's answer to the barren course.
 */

const COURSE_SEED = 2026;
const course = buildCourseWorld(authoredCourse(COURSE_SEED), COURSE_SEED).terrain;

describe("courseFlagstickPositions", () => {
  it("stands one flagstick at every hole's cup, in the course frame", () => {
    const pins = courseFlagstickPositions(course);
    expect(pins).toHaveLength(course.holes.length);
    // Each pin is the hole's own cup carried into the course frame -- not the hole-local cup, and
    // not the origin. Rebuild the transform independently and check they agree.
    const world = { x: 0, z: 0 };
    for (let i = 0; i < course.holes.length; i++) {
      const hole = course.holes[i]!;
      toCourseFrame(hole.placement, hole.spec.cup.x, hole.spec.cup.z, world);
      expect(pins[i]!.x).toBeCloseTo(world.x, 6);
      expect(pins[i]!.z).toBeCloseTo(world.z, 6);
      expect(pins[i]!.y).toBe(course.heightAt(world.x, world.z));
    }
  });
});

describe("deriveCoursePropPlacements", () => {
  it("dresses every hole and keeps each prop inside the course bounds on real ground", () => {
    const placements = deriveCoursePropPlacements(course);
    // Two tee markers plus two pieces of tee furniture on every hole is the floor -- a barren
    // course grew none of these, which is the bug this guards.
    expect(placements.length).toBeGreaterThanOrEqual(course.holes.length * 4);
    for (const p of placements) {
      expect(p.x, `${p.prop} off the west/east edge`).toBeGreaterThanOrEqual(course.bounds.minX);
      expect(p.x).toBeLessThanOrEqual(course.bounds.maxX);
      expect(p.z).toBeGreaterThanOrEqual(course.bounds.minZ);
      expect(p.z).toBeLessThanOrEqual(course.bounds.maxZ);
      // Sat on the blended heightfield the cart drives on, not on a single hole's terrain.
      expect(p.y).toBe(course.heightAt(p.x, p.z));
      expect(Number.isFinite(p.yaw)).toBe(true);
    }
  });

  it("puts each hole's tee furniture at that hole's own tee, not overlaid at the course origin", () => {
    // The transform is the thing that can silently go wrong: drop it and every hole's props land in
    // its local frame, stacked near the origin instead of spread across eighteen tees. So for every
    // hole, independently carry its tee into the course frame and demand a prop standing near it.
    // The tee markers sit 2.4 m either side and the furniture ~5.4 m back, so 8 m catches the box.
    const placements = deriveCoursePropPlacements(course);
    const world = { x: 0, z: 0 };
    for (const hole of course.holes) {
      toCourseFrame(hole.placement, hole.spec.tee.x, hole.spec.tee.z, world);
      const near = placements.some((p) => Math.hypot(p.x - world.x, p.z - world.z) <= 8);
      expect(near, `hole ${hole.spec.index + 1} tee at ${world.x.toFixed(0)},${world.z.toFixed(0)} undressed`).toBe(true);
    }
  });

  it("never emits the boardwalk, whose length is a segment rather than a point", () => {
    // The boardwalk carries `sections` and tiles along a span; it is deliberately excluded here
    // until it is given course-wide handling, so a `boardwalk_section` slipping in as a single
    // point copy would be one authored plank dropped at a pond's midpoint.
    for (const p of deriveCoursePropPlacements(course)) {
      expect(p.prop).not.toBe("boardwalk_section");
    }
  });

  it("is deterministic: the same course derives the same dressing", () => {
    const again = buildCourseWorld(authoredCourse(COURSE_SEED), COURSE_SEED).terrain;
    const a = deriveCoursePropPlacements(course);
    const b = deriveCoursePropPlacements(again);
    expect(b.length).toBe(a.length);
    expect(b[0]).toEqual(a[0]);
    expect(b[b.length - 1]).toEqual(a[a.length - 1]);
  });
});
