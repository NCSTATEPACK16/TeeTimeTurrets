import { describe, expect, it } from "vitest";
import { courseDressingFor } from "./courseDressing";
import type { ArenaSource } from "./scene";
import { generateCourse } from "../sim/course";
import { solveCourseLayout } from "../sim/courseLayout";
import { createCourseSurfaces } from "../sim/courseSurfaces";
import { createCourseTerrain } from "../sim/courseTerrain";
import type { PlacedHole } from "../sim/courseTerrain";
import { createSurfaces } from "../sim/surfaces";
import { createTerrain } from "../sim/terrain";
import { mulberry32 } from "../sim/rng";
import { AUTHORED_SOUTH_BOUNDARY } from "../sim/authoredLayout";

/** A two-hole course, as `courseGround.test.ts` builds one, with the authored road so it has trees. */
function arena(): ArenaSource {
  const generated = generateCourse(2026, 2);
  const layout = solveCourseLayout(
    generated.holes.map((h) => ({ index: h.index, tee: h.tee, cup: h.cup, control: h.control })),
  );
  const placed: PlacedHole[] = layout.placements.map((placement) => {
    const spec = generated.holes[placement.index]!;
    return { placement, spec, terrain: createTerrain(spec) };
  });
  const course = createCourseTerrain(placed, { rough: mulberry32(2026) });
  const surfaces = createCourseSurfaces(course, placed.map((h) => createSurfaces(h.spec, h.terrain)));
  return { course, surfaces, southBoundary: AUTHORED_SOUTH_BOUNDARY, seed: 2026 };
}

describe("courseDressingFor", () => {
  /**
   * A match used to build the whole ground -- 63 far tiles, about half a second -- and the
   * treeline on entry, and free them on exit, so every rematch and every PLAY paid for a course
   * that had not changed.
   */
  it("builds a course's ground and treeline once, however many matches ask", () => {
    const source = arena();
    const first = courseDressingFor(source);
    const second = courseDressingFor(source);
    expect(second.ground).toBe(first.ground);
    expect(second.treeline).toBe(first.treeline);
  });

  it("builds a different course its own", () => {
    const a = courseDressingFor(arena());
    const b = courseDressingFor(arena());
    expect(b.ground).not.toBe(a.ground);
  });
});
