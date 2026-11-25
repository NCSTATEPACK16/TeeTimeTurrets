import type RAPIER from '@dimforge/rapier3d-compat';
import type { GridInfo } from '@gcs/level-schema';
import { physicsConfig } from './physicsConfig';
import type { Rapier } from './world';

/**
 * Four fixed walls just outside the heightfield, so the cart can drive right up to the course
 * edge but never off it. They span the whole relief plus `boundary.wallHeight`, and are not drawn
 * (the horizon skirt continues past them visually).
 */
export function createBoundaryColliders(
  R: Rapier,
  world: RAPIER.World,
  grid: GridInfo,
  minHeight: number,
  maxHeight: number,
): RAPIER.Collider[] {
  const { thickness, wallHeight, below } = physicsConfig.boundary;
  const hx = ((grid.width - 1) / 2) * grid.cellSize;
  const hz = ((grid.height - 1) / 2) * grid.cellSize;
  const bottom = minHeight - below;
  const top = maxHeight + wallHeight;
  const cy = (bottom + top) / 2;
  const hy = (top - bottom) / 2;
  const t = thickness / 2;
  const walls: [number, number, number, number][] = [
    [-hx - t, 0, t, hz + thickness], // west
    [hx + t, 0, t, hz + thickness], // east
    [0, -hz - t, hx + thickness, t], // north
    [0, hz + t, hx + thickness, t], // south
  ];
  return walls.map(([x, z, ex, ez]) =>
    world.createCollider(
      R.ColliderDesc.cuboid(ex, hy, ez)
        .setTranslation(x, cy, z)
        .setFriction(physicsConfig.boundary.friction)
        .setRestitution(physicsConfig.boundary.restitution),
    ),
  );
}
