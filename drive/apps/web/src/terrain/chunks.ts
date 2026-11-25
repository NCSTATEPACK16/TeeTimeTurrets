import { BufferAttribute, BufferGeometry, Group, LOD, Mesh, type Material } from 'three/webgpu';
import { colToX, rowToZ, type GridInfo } from '@gcs/level-schema';
import type { Level } from '../level/loadLevel';
import { envConfig } from '../env/envConfig';
import { buildTerrainChunk, chunkLayout, hexToLinear, strideSamples, type Palette } from './terrainGeometry';

type LodLevel = { readonly stride: number; readonly distance: number };

/** World-space center of a chunk's cell block (where its LOD measures distance from). */
export function chunkCenter(
  grid: GridInfo,
  heights: Float64Array,
  [c0, r0, cols, rows]: readonly number[],
): [number, number, number] {
  const c = c0! + cols! / 2;
  const r = r0! + rows! / 2;
  const y = heights[Math.round(r) * grid.width + Math.round(c)]!;
  return [colToX(grid, c), y, rowToZ(grid, r)];
}

/** Triangles a chunk draws at a stride, skirt included (matches buildTerrainChunk). */
export function chunkTriangles(cols: number, rows: number, stride: number, skirt: boolean): number {
  const vw = strideSamples(0, cols, stride).length;
  const vh = strideSamples(0, rows, stride).length;
  return (vw - 1) * (vh - 1) * 2 + (skirt ? (2 * (vw + vh) - 4) * 4 : 0);
}

/** The LOD level three picks at distance d (ignoring hysteresis): the last whose distance d reaches. */
export function lodIndex(levels: readonly LodLevel[], d: number): number {
  let i = 0;
  while (i + 1 < levels.length && d >= levels[i + 1]!.distance) i++;
  return i;
}

/** Terrain triangles and draw calls with the camera at (x, y, z), before frustum culling (worst case). */
export function terrainLoad(
  level: Level,
  camera: readonly [number, number, number],
  levels: readonly LodLevel[] = envConfig.terrain.lod,
): { triangles: number; drawCalls: number } {
  const skirt = envConfig.terrain.skirtDepth > 0;
  let triangles = 0;
  let drawCalls = 0;
  for (const block of chunkLayout(level.grid, envConfig.terrain.chunkCells)) {
    const [x, y, z] = chunkCenter(level.grid, level.heights, block);
    const d = Math.hypot(x - camera[0], y - camera[1], z - camera[2]);
    triangles += chunkTriangles(block[2], block[3], levels[lodIndex(levels, d)]!.stride, skirt);
    drawCalls++;
  }
  return { triangles, drawCalls };
}

/** Terrain as square chunks (frustum culled individually), each a three LOD over node strides. */
export function createTerrainMeshes(level: Level, material: Material): Group {
  const palette: Palette = level.course.materials.map((m) => hexToLinear(m.color));
  const { lod: levels, lodHysteresis, skirtDepth } = envConfig.terrain;
  const group = new Group();
  group.name = 'terrain';
  for (const block of chunkLayout(level.grid, envConfig.terrain.chunkCells)) {
    const [c0, r0, cols, rows] = block;
    const [cx, cy, cz] = chunkCenter(level.grid, level.heights, block);
    const lod = new LOD();
    lod.name = `terrain-${c0}-${r0}`;
    lod.position.set(cx, cy, cz);
    lod.updateMatrix();
    lod.matrixAutoUpdate = false;
    for (const { stride, distance } of levels) {
      const a = buildTerrainChunk(
        level.grid,
        level.heights,
        level.material,
        palette,
        c0,
        r0,
        cols,
        rows,
        stride,
        skirtDepth,
      );
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(a.positions, 3));
      geometry.setAttribute('normal', new BufferAttribute(a.normals, 3));
      geometry.setAttribute('color', new BufferAttribute(a.colors, 3));
      geometry.setIndex(new BufferAttribute(a.indices, 1));
      geometry.translate(-cx, -cy, -cz);
      geometry.computeBoundingSphere();
      const mesh = new Mesh(geometry, material);
      mesh.name = `${lod.name}-s${stride}`;
      mesh.matrixAutoUpdate = false;
      lod.addLevel(mesh, distance, lodHysteresis);
    }
    group.add(lod);
  }
  return group;
}
