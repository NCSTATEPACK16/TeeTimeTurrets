import { beforeAll, describe, expect, it } from "vitest";
import { arenaFromCourse } from "./arena";
import { authoredCourse } from "./authoredCourse";
import { buildCourseWorld } from "./courseWorld";
import type { CourseWorld } from "./courseWorld";

describe("the course's playfield", () => {
  let world: CourseWorld;
  beforeAll(() => {
    world = buildCourseWorld(authoredCourse(2026), 2026);
  });

  it("builds the heightfield once per course, however many matches are started on it", () => {
    const first = arenaFromCourse(world).playfield.buildHeightfield();
    const second = arenaFromCourse(world).playfield.buildHeightfield();
    // The same array: a second PLAY used to spend ~5 s re-sampling half a million heights.
    expect(second.heights).toBe(first.heights);
  }, 30_000);

  it("answers heights from that heightfield, close to the exact blended course", () => {
    const { playfield } = arenaFromCourse(world);
    const b = playfield.bounds;
    let worst = 0;
    let sum = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const x = b.minX + ((i * 7919) % 997) / 997 * (b.maxX - b.minX);
      const z = b.minZ + ((i * 104729) % 991) / 991 * (b.maxZ - b.minZ);
      const d = Math.abs(playfield.heightAt(x, z) - world.terrain.heightAt(x, z));
      worst = Math.max(worst, d);
      sum += d;
    }
    // A 2 m grid misses only the curvature between its samples.
    expect(sum / n).toBeLessThan(0.02);
    expect(worst).toBeLessThan(0.3);
  }, 30_000);

  it("classifies ground as the exact course does, away from the edges between surfaces", () => {
    const { playfield } = arenaFromCourse(world);
    const b = playfield.bounds;
    let agree = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      const x = b.minX + ((i * 7919) % 997) / 997 * (b.maxX - b.minX);
      const z = b.minZ + ((i * 104729) % 991) / 991 * (b.maxZ - b.minZ);
      if (playfield.surfaces.surfaceAt(x, z) === world.surfaces.surfaceAt(x, z)) agree++;
    }
    // Nearest-node classification only disagrees within a metre of a boundary.
    expect(agree / n).toBeGreaterThan(0.97);
  }, 30_000);
});
