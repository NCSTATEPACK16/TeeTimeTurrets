import { beforeAll, describe, expect, it } from "vitest";
import { arenaFromCourse } from "./arena";
import { authoredCourse } from "./authoredCourse";
import { buildCourseWorld } from "./courseWorld";
import type { CourseWorld } from "./courseWorld";
import type { CourseGrids } from "./courseGrids";
import { mulberry32 } from "./rng";
import { SURFACE_CODES, SurfaceId, createSurfaceTuning } from "./surfaces";

/** The seed main.ts ships. */
const SEED = 2026;

/**
 * How far the baked ground may sit from the blended ground between two grid vertices.
 *
 * Rapier stands the carts on a 2 m heightfield of exactly these vertex heights, so the physics
 * has never seen the blended ground between them; these bounds are what the collider already
 * differed by. A bilinear patch misses the true surface by its curvature only. Measured over
 * 20,000 seeded points: mean 5 mm, 99th percentile 5.9 cm, worst 0.31 m -- the worst on a carved
 * pond bank, the steepest ground on the course and water, which no cart drives on.
 *
 * First stated as a 0.10 m worst case, before measuring, and the pond banks broke it. The mean and
 * the 99th percentile are the bounds that carry the claim: nearest-vertex lookup, the obvious
 * wrong implementation, misses by slope times up to 1.4 m, which fails both.
 */
const MEAN_HEIGHT_ERROR_M = 0.01;
const P99_HEIGHT_ERROR_M = 0.08;
const MAX_HEIGHT_ERROR_M = 0.35;

let world: CourseWorld;
let grids: CourseGrids;

beforeAll(() => {
  world = buildCourseWorld(authoredCourse(SEED), SEED);
  grids = world.grids;
}, 60_000);

/** A seeded point anywhere on the course, never on a vertex by construction of the draw. */
function randomPoints(n: number, seed: number): { x: number; z: number }[] {
  const random = mulberry32(seed);
  const { minX, minZ, maxX, maxZ } = world.terrain.bounds;
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ x: minX + random() * (maxX - minX), z: minZ + random() * (maxZ - minZ) });
  }
  return out;
}

/** A seeded grid vertex, as (col, row) and its course-frame point. */
function randomVertices(n: number, seed: number): { col: number; row: number; x: number; z: number }[] {
  const random = mulberry32(seed);
  const { minX, minZ, maxX, maxZ } = world.terrain.bounds;
  const out: { col: number; row: number; x: number; z: number }[] = [];
  for (let i = 0; i < n; i++) {
    const col = Math.floor(random() * (grids.cols + 1));
    const row = Math.floor(random() * (grids.rows + 1));
    out.push({
      col,
      row,
      x: minX + (col / grids.cols) * (maxX - minX),
      z: minZ + (row / grids.rows) * (maxZ - minZ),
    });
  }
  return out;
}

describe("baked course grids", () => {
  /**
   * The whole point: `Sim.create` used to rebuild 514k blended heights on every PLAY. One world
   * bakes once, and every arena built from it hands Rapier the same array.
   */
  it("bakes once per world, and every arena from it shares one heightfield", () => {
    expect(world.grids).toBe(grids);
    const a = arenaFromCourse(world).playfield.buildHeightfield();
    const b = arenaFromCourse(world).playfield.buildHeightfield();
    expect(a.heights).toBe(b.heights);
    expect(a.heights).toBe(grids.heights);
    expect(a.rows).toBe(world.terrain.rows);
    expect(a.cols).toBe(world.terrain.cols);
  });

  it("stores the blended height exactly at every vertex it samples", () => {
    for (const v of randomVertices(2000, 11)) {
      const stored = grids.heights[v.row + v.col * (grids.rows + 1)];
      expect(stored, `vertex ${v.col},${v.row}`).toBe(Math.fround(world.terrain.heightAt(v.x, v.z)));
      expect(grids.heightAt(v.x, v.z)).toBeCloseTo(stored!, 5);
    }
  });

  it(`stays within ${MEAN_HEIGHT_ERROR_M} m of the blended ground on average, ${P99_HEIGHT_ERROR_M} m at the 99th percentile`, () => {
    const points = randomPoints(5000, 12);
    const errors = points
      .map((p) => Math.abs(grids.heightAt(p.x, p.z) - world.terrain.heightAt(p.x, p.z)))
      .sort((a, b) => a - b);
    const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
    expect(mean).toBeLessThan(MEAN_HEIGHT_ERROR_M);
    expect(errors[Math.floor(errors.length * 0.99)]).toBeLessThan(P99_HEIGHT_ERROR_M);
    expect(errors[errors.length - 1]).toBeLessThan(MAX_HEIGHT_ERROR_M);
  });

  it("classifies each vertex exactly as the blended surfaces do", () => {
    for (const v of randomVertices(2000, 13)) {
      expect(grids.surfaces.surfaceAt(v.x, v.z), `vertex ${v.col},${v.row}`).toBe(
        world.surfaces.surfaceAt(v.x, v.z),
      );
    }
  });

  it("agrees with the blended classification at 98% of points between vertices", () => {
    const points = randomPoints(5000, 14);
    let agree = 0;
    for (const p of points) {
      if (grids.surfaces.surfaceAt(p.x, p.z) === world.surfaces.surfaceAt(p.x, p.z)) agree++;
    }
    expect(agree / points.length).toBeGreaterThan(0.98);
  });

  it("stores the blended tuning exactly at every vertex, hazard flag included", () => {
    const baked = createSurfaceTuning();
    const blended = createSurfaceTuning();
    for (const v of randomVertices(2000, 15)) {
      grids.surfaces.tuningAt(v.x, v.z, baked);
      world.surfaces.tuningAt(v.x, v.z, blended);
      const where = `vertex ${v.col},${v.row}`;
      expect(baked.rolling, where).toBeCloseTo(blended.rolling, 5);
      expect(baked.bounceScale, where).toBeCloseTo(blended.bounceScale, 5);
      expect(baked.cartSpeedScale, where).toBeCloseTo(blended.cartSpeedScale, 5);
      expect(baked.isHazard, where).toBe(blended.isHazard);
    }
  });

  /** A point part-way across a random cell, and the vertex of that cell it lies closest to. */
  function offVertex(seed: number, n: number): { x: number; z: number; nearest: number }[] {
    const random = mulberry32(seed);
    const { minX, minZ, maxX, maxZ } = world.terrain.bounds;
    const out: { x: number; z: number; nearest: number }[] = [];
    for (let i = 0; i < n; i++) {
      const c0 = Math.floor(random() * grids.cols);
      const r0 = Math.floor(random() * grids.rows);
      // Kept clear of the half-way line, so which vertex is nearest has one answer.
      const fx = random() < 0.5 ? 0.3 : 0.7;
      const fz = random() < 0.5 ? 0.3 : 0.7;
      out.push({
        x: minX + ((c0 + fx) / grids.cols) * (maxX - minX),
        z: minZ + ((r0 + fz) / grids.rows) * (maxZ - minZ),
        nearest: (fz < 0.5 ? r0 : r0 + 1) + (fx < 0.5 ? c0 : c0 + 1) * (grids.rows + 1),
      });
    }
    return out;
  }

  it("classifies a point between vertices as its nearest vertex", () => {
    for (const p of offVertex(17, 5000)) {
      expect(SURFACE_CODES.indexOf(grids.surfaces.surfaceAt(p.x, p.z))).toBe(grids.surface[p.nearest]);
    }
  });

  /**
   * Sand, water and the bridge are hard-edged on purpose (`surfaces.ts`). Between vertices a
   * bilinear blend would carry a fairway's roll a metre into a bunker; the nearest vertex's own
   * tuning does not.
   */
  it("keeps sand, water and the bridge hard between vertices", () => {
    const hard = new Set([SurfaceId.Sand, SurfaceId.Water, SurfaceId.Bridge].map((id) => SURFACE_CODES.indexOf(id)));
    const tuning = createSurfaceTuning();
    let checked = 0;
    for (const p of offVertex(18, 400_000)) {
      if (!hard.has(grids.surface[p.nearest]!)) continue;
      grids.surfaces.tuningAt(p.x, p.z, tuning);
      expect(tuning.rolling).toBe(grids.rolling[p.nearest]);
      expect(tuning.bounceScale).toBe(grids.bounceScale[p.nearest]);
      expect(tuning.cartSpeedScale).toBe(grids.cartSpeedScale[p.nearest]);
      checked++;
    }
    expect(checked).toBeGreaterThan(1000);
  });

  /**
   * Water is where the nearest-vertex rule matters: a cart is charged a stroke on `surfaceAt`, and
   * the surface code grid is what answers. Every water vertex has to read as water, and as a hazard.
   */
  it("keeps every baked water vertex a hazard", () => {
    const tuning = createSurfaceTuning();
    let water = 0;
    for (let i = 0; i < grids.surface.length; i++) {
      if (grids.surface[i] !== SURFACE_CODES.indexOf(SurfaceId.Water)) continue;
      water++;
      const col = Math.floor(i / (grids.rows + 1));
      const row = i % (grids.rows + 1);
      const { minX, minZ, maxX, maxZ } = world.terrain.bounds;
      const x = minX + (col / grids.cols) * (maxX - minX);
      const z = minZ + (row / grids.rows) * (maxZ - minZ);
      grids.surfaces.tuningAt(x, z, tuning);
      expect(tuning.isHazard).toBe(true);
    }
    // The authored course has ponds; a grid with no water in it baked the wrong thing.
    expect(water).toBeGreaterThan(100);
  });

  /**
   * The consumer: `Sim` reads heights and materials through the playfield. Between vertices the
   * baked and blended answers differ, so equality with the grid -- and not with the blend -- is
   * what shows the sim is standing on the bake.
   */
  it("is what the course arena's playfield answers from", () => {
    const playfield = arenaFromCourse(world).playfield;
    const fromPlayfield = createSurfaceTuning();
    const fromGrid = createSurfaceTuning();
    let differsFromBlend = 0;
    for (const p of randomPoints(500, 16)) {
      expect(playfield.heightAt(p.x, p.z)).toBe(grids.heightAt(p.x, p.z));
      if (playfield.heightAt(p.x, p.z) !== world.terrain.heightAt(p.x, p.z)) differsFromBlend++;
      expect(playfield.surfaces.surfaceAt(p.x, p.z)).toBe(grids.surfaces.surfaceAt(p.x, p.z));
      playfield.surfaces.tuningAt(p.x, p.z, fromPlayfield);
      grids.surfaces.tuningAt(p.x, p.z, fromGrid);
      expect(fromPlayfield).toEqual(fromGrid);
    }
    expect(differsFromBlend).toBeGreaterThan(400);
  });
});
