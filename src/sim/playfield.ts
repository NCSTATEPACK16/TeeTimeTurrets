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
import type { Bounds } from "./courseLayout";
import type { CourseGrids } from "./courseGrids";
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
 * The whole course as one piece of ground: what arena stands on. Answered from the baked grids,
 * whose heights are also the collider's, so every `Sim` built on one bake shares one array.
 */
export function coursePlayfield(grids: CourseGrids): Playfield {
  const { bounds } = grids;
  return {
    heightAt: (x, z) => grids.heightAt(x, z),
    surfaces: grids.surfaces,
    bounds,
    buildHeightfield: () => ({
      rows: grids.rows,
      cols: grids.cols,
      heights: grids.heights,
      extentX: bounds.maxX - bounds.minX,
      extentZ: bounds.maxZ - bounds.minZ,
      centreX: (bounds.minX + bounds.maxX) / 2,
      centreZ: (bounds.minZ + bounds.maxZ) / 2,
    }),
  };
}
