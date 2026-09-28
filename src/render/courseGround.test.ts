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
import { authoredCourse } from "../sim/authoredCourse";
import { buildCourseWorld } from "../sim/courseWorld";

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
      // Stored as bytes, each rounded to the nearest 1/255.
      expect(sum).toBeLessThanOrEqual(1 + 1.5 / 255);
      if (sum > 0) claimed++;
      const length = Math.hypot(mow.getX(i), mow.getY(i));
      // Either a unit direction or nothing at all -- the shader reads a zero as "unmown". Stored as
      // signed bytes, so unit to within 1/127 on each axis.
      expect(length < 1e-6 || Math.abs(length - 1) < 0.02).toBe(true);
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

/** Runs `update` until the ground has nothing left to build here, or a generous cap. */
function settle(ground: ReturnType<typeof createCourseGround>, x: number, z: number): void {
  for (let i = 0; i < 5000; i++) {
    ground.update(x, z);
    if (!ground.building) return;
  }
}

describe("what a tile costs", () => {
  /**
   * Height, biome weights and the mow direction all come from which holes own a vertex, and each
   * used to ask `weightsInto` for it separately -- `heightAt` inside, then twice more. A counting
   * wrapper sees the calls the ground makes; `heightAt` is counted too, since it hides one.
   */
  it("asks which holes own each grid vertex once", () => {
    const { terrain } = build();
    const surfaces = createCourseSurfaces(
      terrain,
      terrain.holes.map((hole) => createSurfaces(hole.spec, hole.terrain)),
    );
    let weights = 0;
    let heights = 0;
    const counted: CourseTerrain = {
      ...terrain,
      weightsInto: (x, z, out) => {
        weights++;
        return terrain.weightsInto(x, z, out);
      },
      heightAt: (x, z) => {
        heights++;
        return terrain.heightAt(x, z);
      },
    };
    const ground = createCourseGround(counted, surfaces);
    let gridVertices = 0;
    // Every far tile is (cells + 1)^2 grid vertices; count them from the tuning rather than guess.
    for (const mesh of meshes(ground)) {
      const count = mesh.geometry.getAttribute("position").count;
      // total = side^2 + 8 * side, so side = -4 + sqrt(16 + total).
      const side = -4 + Math.sqrt(16 + count);
      gridVertices += side * side;
    }
    expect(heights).toBe(0);
    expect(weights).toBe(gridVertices);
    ground.dispose();
  });

  it("stores biome weights and mow directions as bytes", () => {
    const { ground } = build();
    const geometry = meshes(ground)[0]!.geometry;
    const biome = geometry.getAttribute("aBiome") as THREE.BufferAttribute;
    const mow = geometry.getAttribute("aMow") as THREE.BufferAttribute;
    expect(biome.array).toBeInstanceOf(Uint8Array);
    expect(biome.normalized).toBe(true);
    expect(mow.array).toBeInstanceOf(Int8Array);
    expect(mow.normalized).toBe(true);
    ground.dispose();
  });

  /**
   * Once a tile's buffers are on the GPU, only positions and the index are read on the CPU again
   * (bounds, and the smoke's NaN check). The rest is let go when three uploads it, which calls
   * `onUploadCallback` -- called here by hand, as `WebGLAttributes` would.
   */
  it("lets go of the CPU copies the GPU owns once they are uploaded, and keeps its bounds", () => {
    const { ground } = build();
    const geometry = meshes(ground)[0]!.geometry;
    expect(geometry.boundingSphere).not.toBeNull();
    const radius = geometry.boundingSphere!.radius;
    for (const name of ["aBiome", "aMow", "uv", "normal"]) {
      const attribute = geometry.getAttribute(name) as THREE.BufferAttribute;
      expect(attribute.array.length, name).toBeGreaterThan(0);
      attribute.onUploadCallback();
      expect(attribute.array.length, `${name} after upload`).toBe(0);
    }
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    position.onUploadCallback();
    expect(position.array.length).toBeGreaterThan(0);
    expect(geometry.boundingSphere!.radius).toBe(radius);
    ground.dispose();
  });
});

describe("near tiles over a drive around the whole course", () => {
  const { NEAR_TILE_CAP, NEAR_RADIUS_M, NEAR_HYSTERESIS_M } = COURSE_GROUND_TUNING;

  it(`keeps at most ${NEAR_TILE_CAP} resident, and still refines the ground under the camera`, () => {
    const world = buildCourseWorld(authoredCourse(COURSE_SEED), COURSE_SEED);
    const ground = createCourseGround(world.terrain, world.surfaces);
    const { minX, minZ, maxX, maxZ } = world.terrain.bounds;
    const inset = 150;
    const corners = [
      [minX + inset, minZ + inset],
      [maxX - inset, minZ + inset],
      [maxX - inset, maxZ - inset],
      [minX + inset, maxZ - inset],
      [minX + inset, minZ + inset],
    ] as const;
    let most = 0;
    let underCamera = 0;
    let waypoints = 0;
    for (let c = 0; c + 1 < corners.length; c++) {
      const [ax, az] = corners[c]!;
      const [bx, bz] = corners[c + 1]!;
      const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 90);
      for (let s = 0; s < steps; s++) {
        const x = ax + ((bx - ax) * s) / steps;
        const z = az + ((bz - az) * s) / steps;
        settle(ground, x, z);
        most = Math.max(most, ground.residentNearTiles);
        expect(ground.residentNearTiles).toBeLessThanOrEqual(NEAR_TILE_CAP);
        if (ground.tileAt(x, z)!.level === "near") underCamera++;
        waypoints++;
      }
    }
    // The premise: a lap wants far more distinct tiles than the cap, so the cap was reached and
    // something was evicted -- otherwise a ground that never evicts passes this too.
    expect(ground.nearBuilds).toBeGreaterThan(NEAR_TILE_CAP * 2);
    expect(most).toBe(NEAR_TILE_CAP);
    // And capping did not cost the ground the camera is standing on.
    expect(underCamera).toBe(waypoints);
    ground.dispose();
  }, 120_000);

  /**
   * Least recently wanted goes first. Tiles are stored west to east, south to north, so the drive
   * starts in the north-east corner and moves to the south-west: an eviction that took whichever
   * idle tile came first in storage order would clear the south-west (the newer) and keep the
   * north-east (the older), and fail this.
   */
  it("evicts the tiles wanted longest ago first", () => {
    const world = buildCourseWorld(authoredCourse(COURSE_SEED), COURSE_SEED);
    const ground = createCourseGround(world.terrain, world.surfaces);
    const { minX, minZ, maxX, maxZ } = world.terrain.bounds;
    const northEast = { x: maxX - 150, z: maxZ - 150 };
    const southWest = { x: minX + 150, z: minZ + 150 };
    const southEast = { x: maxX - 150, z: minZ + 150 };
    /** Resident tiles within the near radius of a point, sampled on a 60 m lattice. */
    const residentAround = (p: { x: number; z: number }): number => {
      const seen = new Set<string>();
      for (let dx = -NEAR_RADIUS_M; dx <= NEAR_RADIUS_M; dx += 60) {
        for (let dz = -NEAR_RADIUS_M; dz <= NEAR_RADIUS_M; dz += 60) {
          const tile = ground.tileAt(p.x + dx, p.z + dz);
          if (tile?.resident) seen.add(`${tile.minX},${tile.minZ}`);
        }
      }
      return seen.size;
    };
    settle(ground, northEast.x, northEast.z);
    settle(ground, southWest.x, southWest.z);
    const northEastBefore = residentAround(northEast);
    const southWestBefore = residentAround(southWest);
    settle(ground, southEast.x, southEast.z);
    const evicted = ground.nearBuilds - ground.residentNearTiles;
    // The premise: the third stop had to evict, or order is not being tested at all.
    expect(evicted).toBeGreaterThan(0);
    expect(evicted).toBeLessThan(northEastBefore);
    // Every eviction came out of the older stop, and the newer one kept all it had.
    expect(residentAround(southWest)).toBe(southWestBefore);
    expect(residentAround(northEast)).toBe(northEastBefore - evicted);
    ground.dispose();
  }, 120_000);

  it(`keeps a tile near until the camera is ${NEAR_HYSTERESIS_M} m past the radius that made it so`, () => {
    const { terrain, ground } = build();
    const x = (terrain.bounds.minX + terrain.bounds.maxX) / 2;
    const z = (terrain.bounds.minZ + terrain.bounds.maxZ) / 2;
    settle(ground, x, z);
    expect(ground.tileAt(x, z)!.level).toBe("near");
    // Straight out along -X from the tile's west edge: the tile's distance is exactly the offset.
    const west = ground.tileAt(x, z)!.minX;
    const inBand = west - NEAR_RADIUS_M - NEAR_HYSTERESIS_M / 2;
    settle(ground, inBand, z);
    expect(ground.tileAt(x, z)!.level).toBe("near");
    const past = west - NEAR_RADIUS_M - NEAR_HYSTERESIS_M - 1;
    settle(ground, past, z);
    expect(ground.tileAt(x, z)!.level).toBe("far");
    // Coming back inside the band does not bring it back: only inside the radius does.
    settle(ground, inBand, z);
    expect(ground.tileAt(x, z)!.level).toBe("far");
    ground.dispose();
  });
});
