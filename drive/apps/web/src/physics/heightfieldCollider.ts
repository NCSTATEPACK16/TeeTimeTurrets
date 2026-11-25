import type RAPIER from '@dimforge/rapier3d-compat';
import type { GridInfo } from '@gcs/level-schema';
import { physicsConfig } from './physicsConfig';
import type { Rapier } from './world';

/**
 * Rapier heightfield layout (pinned by test/physics/heightfieldLayout.test.ts):
 * - `heightfield(nrows, ncols, ...)` takes subdivision counts; the heights matrix is
 *   (nrows + 1) x (ncols + 1) nodes.
 * - Matrix rows run along +Z and columns along +X, stored column-major:
 *   index = row + col * (nrows + 1).
 * - The field spans scale.x by scale.z, centered on the collider origin.
 * The packet is row-major with row 0 at -Z, so it is transposed here; centering on the
 * origin matches the packet's world convention.
 */
export function toRapierHeights(grid: GridInfo, heights: Float64Array): Float32Array {
  const { width, height } = grid;
  const out = new Float32Array(width * height);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      out[row + col * height] = heights[row * width + col]!;
    }
  }
  return out;
}

/** Fixed collider for the whole terrain. The cart drives on this; water is not a collider. */
export function createHeightfieldCollider(
  R: Rapier,
  world: RAPIER.World,
  grid: GridInfo,
  heights: Float64Array,
): RAPIER.Collider {
  const desc = R.ColliderDesc.heightfield(
    grid.height - 1,
    grid.width - 1,
    toRapierHeights(grid, heights),
    { x: (grid.width - 1) * grid.cellSize, y: 1, z: (grid.height - 1) * grid.cellSize },
    R.HeightFieldFlags.FIX_INTERNAL_EDGES,
  )
    .setTranslation(0, 0, 0)
    .setFriction(physicsConfig.groundFriction)
    .setRestitution(physicsConfig.groundRestitution);
  return world.createCollider(desc);
}
