/**
 * Gray-box tree dimensions, shared by the renderer (env/trees.ts) and the trunk colliders
 * (core/sim.ts) so what you see is what you hit. Scaled per tree by scatter.bin.
 */
export const treeConfig = {
  pine: { trunkRadius: 0.18, trunkHeight: 4, canopyRadius: 2.1, canopyHeight: 8 },
  /** canopyDetail: icosahedron subdivisions of the gray-box canopy (0 = 20 triangles; M2 render budget on 18 holes). */
  oak: { trunkRadius: 0.28, trunkHeight: 3.2, canopyRadius: 3.3, canopyDetail: 0 },
  /** Trunk collider bounce and friction: soft, never a wall you stick to. */
  trunkRestitution: 0.2,
  trunkFriction: 0.4,
} as const;

/** Trunk radius and height for a scatter species name, or null for unknown species. */
export function trunkFor(species: string): { radius: number; height: number } | null {
  if (species === 'loblolly_pine') return { radius: treeConfig.pine.trunkRadius, height: treeConfig.pine.trunkHeight };
  if (species === 'white_oak') return { radius: treeConfig.oak.trunkRadius, height: treeConfig.oak.trunkHeight };
  return null;
}
