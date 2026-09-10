import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { COURSE_GROUND_TUNING, createCourseGround } from "./courseGround";
import { generateCourse } from "../sim/course";
import { solveCourseLayout } from "../sim/courseLayout";
import { createCourseSurfaces } from "../sim/courseSurfaces";
import { createCourseTerrain } from "../sim/courseTerrain";
import type { CourseTerrain, PlacedHole } from "../sim/courseTerrain";
import { createSurfaces } from "../sim/surfaces";
import { createTerrain } from "../sim/terrain";
import { mulberry32 } from "../sim/rng";

/**
 * Geometry and LOD only -- there is no WebGL in the node environment, so what a tile *looks* like
 * is the Scene Gate's `course-ground` subject and what a tile *is* is here.
 */

const COURSE_SEED = 2026;
/** Two holes: enough for a course with tiles in it, small enough to build in a test. */
const TEST_HOLES = 2;

function build(holes = TEST_HOLES): {
  terrain: CourseTerrain;
  ground: ReturnType<typeof createCourseGround>;
} {
  const generated = generateCourse(COURSE_SEED, holes);
  const layout = solveCourseLayout(
    generated.holes.map((h) => ({ index: h.index, tee: h.tee, cup: h.cup, control: h.control })),
  );
  const placed: PlacedHole[] = layout.placements.map((placement) => {
    const spec = generated.holes[placement.index]!;
    return { placement, spec, terrain: createTerrain(spec) };
  });
  const terrain = createCourseTerrain(placed, { rough: mulberry32(COURSE_SEED) });
  const surfaces = createCourseSurfaces(
    terrain,
    placed.map((hole) => createSurfaces(hole.spec, hole.terrain)),
  );
  return { terrain, ground: createCourseGround(terrain, surfaces) };
}

function meshes(ground: { group: THREE.Group }): THREE.Mesh[] {
  return ground.group.children.filter((child): child is THREE.Mesh => (child as THREE.Mesh).isMesh);
}

function positionsOf(mesh: THREE.Mesh): Float32Array {
  return (mesh.geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
}

describe("the tiles", () => {
  it("cover the course and nothing outside it", () => {
    const { terrain, ground } = build();
    const box = new THREE.Box3();
    for (const mesh of meshes(ground)) box.union(new THREE.Box3().setFromObject(mesh));

    expect(box.min.x).toBeCloseTo(terrain.bounds.minX, 3);
    expect(box.max.x).toBeCloseTo(terrain.bounds.maxX, 3);
    expect(box.min.z).toBeCloseTo(terrain.bounds.minZ, 3);
    expect(box.max.z).toBeCloseTo(terrain.bounds.maxZ, 3);
    // More than one, or "tiled" is a word rather than a design.
    expect(meshes(ground).length).toBeGreaterThan(1);
    ground.dispose();
  });

  it("stands on the same ground the physics does", () => {
    const { terrain, ground } = build();
    const mesh = meshes(ground)[0]!;
    const positions = positionsOf(mesh);

    // Grid vertices only: the skirt below them is deliberately not on the surface.
    let checked = 0;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i]!;
      const y = positions[i + 1]!;
      const z = positions[i + 2]!;
      const height = terrain.heightAt(x, z);
      if (Math.abs(y - height) < 1e-3) {
        checked++;
        continue;
      }
      // Anything else must be a skirt vertex, which hangs exactly SKIRT_M below its rim.
      expect(y).toBeCloseTo(height - COURSE_GROUND_TUNING.SKIRT_M, 3);
    }
    expect(checked).toBeGreaterThan(100);
    ground.dispose();
  });

  it("hangs a skirt on every tile, exactly as deep as it says", () => {
    const { terrain, ground } = build();
    for (const mesh of meshes(ground)) {
      const positions = positionsOf(mesh);
      let skirted = 0;
      for (let i = 0; i < positions.length; i += 3) {
        const drop = terrain.heightAt(positions[i]!, positions[i + 2]!) - positions[i + 1]!;
        // Every vertex is either on the ground or hanging under it, and none hangs deeper than
        // the apron: a vertex above the ground would be a hole in the tile.
        expect(drop).toBeGreaterThan(-1e-3);
        expect(drop).toBeLessThan(COURSE_GROUND_TUNING.SKIRT_M + 1e-3);
        if (Math.abs(drop - COURSE_GROUND_TUNING.SKIRT_M) < 1e-3) skirted++;
      }
      // The count is the point: without it this test passes on a tile with no skirt at all, which
      // is how it read the first time it was written.
      expect(skirted).toBeGreaterThan(0);
    }
    ground.dispose();
  });
});

describe("level of detail", () => {
  it("starts every tile coarse and refines the one the camera is on", () => {
    const { terrain, ground } = build();
    const before = meshes(ground).length;
    expect(ground.nearTileCount).toBe(0);

    const centreX = (terrain.bounds.minX + terrain.bounds.maxX) / 2;
    const centreZ = (terrain.bounds.minZ + terrain.bounds.maxZ) / 2;
    for (let i = 0; i < 5000; i++) {
      ground.update(centreX, centreZ);
      if (ground.nearTileCount > 0) break;
    }

    expect(ground.nearTileCount).toBeGreaterThan(0);
    // A near tile is an addition, not a replacement: the far one is kept and hidden.
    expect(meshes(ground).length).toBeGreaterThan(before);
    ground.dispose();
  });

  it("builds a near tile finer than the far one it replaces", () => {
    const { terrain, ground } = build();
    const centreX = (terrain.bounds.minX + terrain.bounds.maxX) / 2;
    const centreZ = (terrain.bounds.minZ + terrain.bounds.maxZ) / 2;
    const farCounts = meshes(ground).map((m) => positionsOf(m).length);

    for (let i = 0; i < 5000; i++) {
      ground.update(centreX, centreZ);
      if (ground.nearTileCount > 0) break;
    }
    const near = meshes(ground).filter((m) => m.visible && !farCounts.includes(positionsOf(m).length));
    expect(near.length).toBeGreaterThan(0);

    const ratio = COURSE_GROUND_TUNING.FAR_CELL_M / COURSE_GROUND_TUNING.NEAR_CELL_M;
    // Vertices go as the square of the cell ratio, less the skirt, so this is a floor rather than
    // an equality -- but a "near" tile that was not finer would sail past a weaker assertion.
    expect(positionsOf(near[0]!).length).toBeGreaterThan(farCounts[0]! * ratio);
    ground.dispose();
  });

  it("leaves a tile the camera never approaches coarse", () => {
    // Six holes rather than two: a two-hole course fits inside NEAR_RADIUS_M from any corner of
    // it, so there would be no distant tile for this to be about.
    const { terrain, ground } = build(6);
    // A corner, far enough out that the tiles on the far side stay beyond NEAR_RADIUS_M.
    const x = terrain.bounds.minX;
    const z = terrain.bounds.minZ;
    for (let i = 0; i < 5000; i++) ground.update(x, z);

    const visible = meshes(ground).filter((m) => m.visible);
    expect(ground.nearTileCount).toBeGreaterThan(0);
    // The control on the promotion tests: not everything got promoted, so "near" means near.
    expect(ground.nearTileCount).toBeLessThan(visible.length);
    ground.dispose();
  });
});

describe("what the shader is handed", () => {
  it("gives every vertex biome weights and a mow direction", () => {
    const { ground } = build();
    const mesh = meshes(ground)[0]!;
    const biome = mesh.geometry.getAttribute("aBiome") as THREE.BufferAttribute;
    const mow = mesh.geometry.getAttribute("aMow") as THREE.BufferAttribute;
    const positions = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;

    expect(biome.count).toBe(positions.count);
    expect(mow.count).toBe(positions.count);

    let mown = 0;
    let claimed = 0;
    for (let i = 0; i < biome.count; i++) {
      const sum = biome.getX(i) + biome.getY(i) + biome.getZ(i);
      expect(sum).toBeGreaterThanOrEqual(0);
      expect(sum).toBeLessThanOrEqual(1 + 1e-6);
      if (sum > 0) claimed++;
      const length = Math.hypot(mow.getX(i), mow.getY(i));
      // Either a unit direction or nothing at all -- the shader reads a zero as "unmown".
      expect(length < 1e-6 || Math.abs(length - 1) < 1e-6).toBe(true);
      if (length > 0.5) mown++;
    }
    // Both controls: some of this tile is a hole's ground and some of it is open rough, so
    // neither branch above went unexercised.
    expect(claimed).toBeGreaterThan(0);
    expect(mown).toBeGreaterThan(0);
    expect(mown).toBeLessThan(biome.count);
    ground.dispose();
  });

  it("gives every tile a mask and every material the same program", () => {
    const { ground } = build();
    const all = meshes(ground);
    const keys = new Set<string>();
    for (const mesh of all) {
      const material = mesh.material as THREE.MeshStandardMaterial;
      expect(material.map).not.toBeNull();
      keys.add(material.customProgramCacheKey!());
    }
    // One key across every tile: dozens of programs for one texture's difference is the thing
    // the map slot exists to avoid.
    expect(keys.size).toBe(1);
    ground.dispose();
  });
});
