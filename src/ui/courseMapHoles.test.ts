import { describe, expect, it } from "vitest";
import { authoredCourse } from "../sim/authoredCourse";
import { buildCourseWorld } from "../sim/courseWorld";
import { SurfaceId } from "../sim/surfaces";
import { toCourseFrame } from "./mapCamera";
import { courseMapHoles, nearestHoleNumber } from "./courseMapHoles";

const SEED = 2026;
const world = buildCourseWorld(authoredCourse(SEED), SEED);
const arena = { course: world.terrain, surfaces: world.surfaces };

describe("courseMapHoles", () => {
  const holes = courseMapHoles(arena);

  it("maps all eighteen holes, numbered as the card numbers them, each where the course put it", () => {
    expect(holes.map((h) => h.number)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    for (const h of holes) {
      const placed = world.holes.find((p) => p.spec.index === h.number - 1)!;
      expect(h.field.offsetX).toBe(placed.placement.offsetX);
      expect(h.field.offsetZ).toBe(placed.placement.offsetZ);
      expect(h.field.rotation).toBe(placed.placement.rotation);
      expect(h.field.fieldSize).toBe(placed.spec.fieldSize);
    }
  });

  it("puts each hole's green where the course has it", () => {
    for (const h of holes) {
      const cup = { x: 0, z: 0 };
      toCourseFrame(h.field, h.cup.x, h.cup.z, cup);
      expect(world.surfaces.surfaceAt(cup.x, cup.z)).toBe(SurfaceId.Green);
      expect(h.runs.some((r) => r.surface === SurfaceId.Green)).toBe(true);
      expect(h.contours.length).toBeGreaterThan(0);
    }
  });

  it("builds once per course and hands back the same holes after", () => {
    expect(courseMapHoles(arena)).toBe(holes);
  });

  it("names the hole whose centre is nearest a point", () => {
    const h = holes[9]!;
    expect(nearestHoleNumber(holes, h.field.offsetX + 3, h.field.offsetZ - 2)).toBe(h.number);
  });
});
