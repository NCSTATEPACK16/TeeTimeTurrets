/**
 * The ground `Sim` is standing on, whichever mode built it.
 *
 * Stroke play stands on one hole: a square field centred on its own origin, 1 m cells, with the
 * ball's grade budget in it. Arena stands on the whole course: eighteen holes assembled by
 * `courseTerrain.ts`, 2 m cells, a box that is not square and not centred on anything in
 * particular. `Sim` needs four things from either -- a height, a material, a boundary and a
 * heightfield to hand Rapier -- and this is that seam.
 *
 * It deliberately carries nothing about *holes*. Tees, cups, pars, pins and targets stay on
 * `Terrain`/`HoleSpec` where they belong; a mode that has no par should not be handed one through
 * the ground it drives on.
 *
 * DOM-free, and the queries are the per-tick ones, so nothing here allocates.
 */
import { BakedSurfaces, gridHeightAt, heightGridFrom } from "./bakedGround";
import type { HeightGrid } from "./bakedGround";
import type { Bounds } from "./courseLayout";
import type { CourseTerrain } from "./courseTerrain";
import type { Surfaces } from "./surfaces";
import type { Terrain } from "./terrain";

/**
 * A heightfield in the shape Rapier's `ColliderDesc.heightfield` wants it: `rows` along Z and
 * `cols` along X, heights column-major, and the box the grid covers.
 */
export interface PlayfieldHeightfield {
  readonly rows: number;
  readonly cols: number;
  readonly heights: Float32Array;
  /** Metres spanned on each axis -- Rapier's `scale`, which maps its unit grid onto the world. */
  readonly extentX: number;
  readonly extentZ: number;
  /** Where the middle of the grid sits, which is where the collider is translated to. */
  readonly centreX: number;
  readonly centreZ: number;
}

export interface Playfield {
  heightAt(x: number, z: number): number;
  readonly surfaces: Surfaces;
  /** The box the ground covers. Past it there is no ground, which is what out of bounds means. */
  readonly bounds: Bounds;
  buildHeightfield(): PlayfieldHeightfield;
}

/** One hole: what stroke play has always stood on. */
export function holePlayfield(terrain: Terrain, surfaces: Surfaces): Playfield {
  const half = terrain.spec.fieldSize / 2;
  return {
    heightAt: (x, z) => terrain.heightAt(x, z),
    surfaces,
    bounds: { minX: -half, minZ: -half, maxX: half, maxZ: half },
    buildHeightfield: () => ({
      rows: terrain.spec.cells,
      cols: terrain.spec.cells,
      heights: terrain.buildHeightfield(),
      extentX: terrain.spec.fieldSize,
      extentZ: terrain.spec.fieldSize,
      centreX: 0,
      centreZ: 0,
    }),
  };
}

/**
 * The whole course as one piece of ground: what arena stands on.
 *
 * Answered from the baked grids (`bakedGround.ts`), not the exact blend: heights by bilinear
 * lookup on the heightfield Rapier collides with, surfaces and tuning from lazily baked tiles. The
 * heightfield is sampled the first time anything asks for a height or for the collider, and kept.
 * `arenaFromCourse` keeps one of these per course, so a second match reuses both.
 */
export function coursePlayfield(terrain: CourseTerrain, surfaces: Surfaces): Playfield {
  let grid: HeightGrid | null = null;
  const heights = (): HeightGrid => {
    grid ??= heightGridFrom(terrain.bounds, terrain.cols, terrain.rows, terrain.buildHeightfield());
    return grid;
  };
  const baked = new BakedSurfaces(surfaces, terrain.bounds, terrain.cellM);
  return {
    heightAt: (x, z) => gridHeightAt(heights(), x, z),
    surfaces: baked,
    bounds: terrain.bounds,
    buildHeightfield: () => ({
      rows: terrain.rows,
      cols: terrain.cols,
      heights: heights().heights,
      extentX: terrain.bounds.maxX - terrain.bounds.minX,
      extentZ: terrain.bounds.maxZ - terrain.bounds.minZ,
      centreX: (terrain.bounds.minX + terrain.bounds.maxX) / 2,
      centreZ: (terrain.bounds.minZ + terrain.bounds.maxZ) / 2,
    }),
  };
}
