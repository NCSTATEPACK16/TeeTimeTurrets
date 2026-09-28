import { describe, expect, it } from "vitest";
import { authoredCourse } from "./authoredCourse";
import { AUTHORED_CLUBHOUSE, AUTHORED_PLACEMENTS } from "./authoredLayout";
import { ARENA_HOLE_INDICES } from "./arenaZone";
import { toCourseFrame } from "./courseGeometry";
import { SURFACES, SurfaceId, createSurfaceTuning } from "./surfaces";
import { PATH_HALF_WIDTH_M, PATH_SPEED_SCALE, applyPathBonus, createCartPaths, pathWeightAt } from "./cartPaths";

const specs = authoredCourse(2026).holes;
const holes = AUTHORED_PLACEMENTS.map((placement) => ({ placement, spec: specs[placement.index]! }));
const paths = createCartPaths(holes, AUTHORED_CLUBHOUSE);

function teeOf(index: number): { x: number; z: number } {
  const hole = holes.find((h) => h.spec.index === index)!;
  const out = { x: 0, z: 0 };
  toCourseFrame(hole.placement, hole.spec.tee.x, hole.spec.tee.z, out);
  return out;
}

describe("cart paths", () => {
  it("run from the clubhouse to every arena tee", () => {
    for (const index of ARENA_HOLE_INDICES) {
      const tee = teeOf(index);
      const toTee = paths.find(
        (p) =>
          Math.hypot(p.points[0]!.x - AUTHORED_CLUBHOUSE.x, p.points[0]!.z - AUTHORED_CLUBHOUSE.z) < 1 &&
          Math.hypot(p.points[p.points.length - 1]!.x - tee.x, p.points[p.points.length - 1]!.z - tee.z) < 1,
      );
      expect(toTee, `no path to hole ${index + 1}`).toBeDefined();
    }
  });

  it("run from each green to the next tee", () => {
    const greenToTee = paths.filter((p) => p.kind === "green-to-tee");
    expect(greenToTee.length).toBe(holes.length - 1);
  });

  it("weigh 1 on the path, and nothing a few metres off it", () => {
    const tee = teeOf(0);
    const path = paths.find((p) => p.kind === "clubhouse" && p.points[p.points.length - 1]!.x === tee.x)!;
    const a = path.points[0]!;
    const b = path.points[1]!;
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    expect(pathWeightAt(paths, mx, mz)).toBe(1);
    const nx = -(b.z - a.z) / Math.hypot(b.x - a.x, b.z - a.z);
    const nz = (b.x - a.x) / Math.hypot(b.x - a.x, b.z - a.z);
    expect(pathWeightAt(paths, mx + nx * (PATH_HALF_WIDTH_M + 3), mz + nz * (PATH_HALF_WIDTH_M + 3))).toBe(0);
  });

  it("lift a cart's speed on the path above what any surface gives, and leave it alone off it", () => {
    const t = createSurfaceTuning();
    Object.assign(t, SURFACES[SurfaceId.Rough]);
    applyPathBonus(t, 1);
    expect(t.cartSpeedScale).toBeCloseTo(PATH_SPEED_SCALE, 6);
    expect(PATH_SPEED_SCALE).toBeGreaterThan(1);
    const off = createSurfaceTuning();
    Object.assign(off, SURFACES[SurfaceId.Rough]);
    applyPathBonus(off, 0);
    expect(off.cartSpeedScale).toBe(SURFACES[SurfaceId.Rough].cartSpeedScale);
  });
});
