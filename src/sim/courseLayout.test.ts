import { describe, expect, it } from "vitest";
import {
  CORRIDOR_CLEARANCE_M,
  TRANSITION_M,
  TRANSITION_MIN_M,
  TRANSITION_MAX_M,
  inspectLayout,
  toCourseFrame,
  toHoleFrame,
} from "./courseLayout";
import type { CourseLayout, LayoutHole } from "./courseLayout";
import { authoredCourse } from "./authoredCourse";
import { authoredCourseLayout } from "./authoredLayout";

/**
 * The frame transforms and the layout inspector. The shipped layout's own properties (both nines
 * return, corridors keep clear, the road) are `authoredLayout.test.ts`'s.
 */

describe("transition slack bounds", () => {
  it("brackets the shipped target", () => {
    expect(TRANSITION_MIN_M).toBeLessThan(TRANSITION_M);
    expect(TRANSITION_MAX_M).toBeGreaterThan(TRANSITION_M);
  });
});

describe("inspectLayout", () => {
  it("notices corridors that run into each other", () => {
    // Two holes forced onto the same ground: the report has to say so, or it is decoration.
    const holes: LayoutHole[] = authoredCourse(2026).holes.map((h) => ({
      index: h.index,
      tee: h.tee,
      cup: h.cup,
      control: h.control,
    }));
    const layout = authoredCourseLayout();
    // The control: the shipped layout is clean, so a conflict below is the collision's doing.
    expect(inspectLayout(holes, layout).conflicts).toEqual([]);
    // Hole 6 dropped exactly on hole 4. Both sit mid-nine, well away from the clubhouse apron
    // where holes are allowed to converge, so this cannot be excused by that exemption.
    const onto = layout.placements.find((p) => p.index === 3)!;
    const collided: CourseLayout = {
      clubhouse: layout.clubhouse,
      placements: layout.placements.map((p) =>
        p.index === 5 ? { ...p, offsetX: onto.offsetX, offsetZ: onto.offsetZ, rotation: onto.rotation } : p,
      ),
    };
    const report = inspectLayout(holes, collided);
    expect(report.conflicts.length).toBeGreaterThan(0);
    expect(report.minClearanceM).toBeLessThan(CORRIDOR_CLEARANCE_M);
  });
});

describe("toHoleFrame", () => {
  /** Offset, and turned by something that is not a multiple of a quarter turn: at 90 degrees a
   *  sign error in the inverse rotation is invisible, because sin and cos swap cleanly. */
  const frame = { offsetX: 320, offsetZ: -140, rotation: 0.7 };

  it("undoes toCourseFrame", () => {
    const course = { x: 0, z: 0 };
    const back = { x: 0, z: 0 };
    toCourseFrame(frame, 37, -19, course);
    toHoleFrame(frame, course.x, course.z, back);
    expect(back.x).toBeCloseTo(37, 9);
    expect(back.z).toBeCloseTo(-19, 9);
  });

  it("puts the frame's own offset at the hole's origin", () => {
    const out = { x: 0, z: 0 };
    toHoleFrame(frame, frame.offsetX, frame.offsetZ, out);
    expect(out.x).toBeCloseTo(0, 9);
    expect(out.z).toBeCloseTo(0, 9);
    // The positive control: a point that is not the offset does not land on the origin, so this
    // cannot pass on an implementation that returns zero.
    toHoleFrame(frame, frame.offsetX + 25, frame.offsetZ, out);
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(25, 9);
  });

  it("rotates the opposite way from toCourseFrame", () => {
    // A quarter turn sends local +X to course +Z, so reading course +Z must give back local +X.
    // Rotating the same way instead would answer local -X.
    const out = { x: 0, z: 0 };
    toHoleFrame({ offsetX: 0, offsetZ: 0, rotation: Math.PI / 2 }, 0, 10, out);
    expect(out.x).toBeCloseTo(10, 9);
    expect(out.z).toBeCloseTo(0, 9);
  });

  it("is a rigid motion: it moves points without stretching the distances between them", () => {
    const a = { x: 0, z: 0 };
    const b = { x: 0, z: 0 };
    toHoleFrame(frame, 100, 60, a);
    toHoleFrame(frame, 130, 20, b);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeCloseTo(Math.hypot(100 - 130, 60 - 20), 9);
  });
});
