import {
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardNodeMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from 'three/webgpu';
import { color } from 'three/tsl';
import type { HeightSampler } from '../level/heightSampler';
import type { Level } from '../level/loadLevel';
import { treeConfig } from '../level/treeConfig';
import { envConfig } from './envConfig';

function solid(hex: string): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 });
  m.colorNode = color(hex);
  return m;
}

/** Gray-box tree part geometries per species (shared by the scene and the render budget test). */
export function treeGeometries(): Record<string, { trunk: BufferGeometry; canopy: BufferGeometry }> {
  const t = treeConfig;
  return {
    loblolly_pine: {
      trunk: new CylinderGeometry(t.pine.trunkRadius, t.pine.trunkRadius, t.pine.trunkHeight, 6).translate(0, t.pine.trunkHeight / 2, 0),
      canopy: new ConeGeometry(t.pine.canopyRadius, t.pine.canopyHeight, 8).translate(0, t.pine.trunkHeight - 1 + t.pine.canopyHeight / 2, 0),
    },
    white_oak: {
      trunk: new CylinderGeometry(t.oak.trunkRadius, t.oak.trunkRadius, t.oak.trunkHeight, 6).translate(0, t.oak.trunkHeight / 2, 0),
      canopy: new IcosahedronGeometry(t.oak.canopyRadius, t.oak.canopyDetail).translate(0, t.oak.trunkHeight + t.oak.canopyRadius * 0.6, 0),
    },
  };
}

const trianglesOf = (g: BufferGeometry) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;

/** Triangles and draw calls the instanced trees add (every instance drawn: InstancedMesh culls as a whole). */
export function treeLoad(level: Level): { triangles: number; drawCalls: number } {
  const geos = treeGeometries();
  let triangles = 0;
  let drawCalls = 0;
  for (const species of level.course.scatter.species) {
    const g = geos[species.name];
    if (!g || species.count === 0) continue;
    triangles += species.count * (trianglesOf(g.trunk) + trianglesOf(g.canopy));
    drawCalls += 2;
  }
  return { triangles, drawCalls };
}

/** Gray-box tree proxies from scatter.bin, one InstancedMesh per part. Trunk colliders live in core/sim.ts. */
export function createTrees(level: Level, heights: HeightSampler): Group {
  const colors = envConfig.trees;
  const group = new Group();
  group.name = 'trees';
  const trunkMat = solid(colors.trunkColor);
  const geos = treeGeometries();
  const parts: Record<string, { trunk: BufferGeometry; canopy: BufferGeometry; canopyMat: MeshStandardNodeMaterial }> = {
    loblolly_pine: { ...geos.loblolly_pine!, canopyMat: solid(colors.pineColor) },
    white_oak: { ...geos.white_oak!, canopyMat: solid(colors.oakColor) },
  };

  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const p = new Vector3();
  const s = new Vector3();
  for (const species of level.course.scatter.species) {
    const def = parts[species.name];
    if (!def || species.count === 0) continue;
    const trunks = new InstancedMesh(def.trunk, trunkMat, species.count);
    const canopies = new InstancedMesh(def.canopy, def.canopyMat, species.count);
    const first = species.byteOffset / 16;
    for (let i = 0; i < species.count; i++) {
      const k = (first + i) * 4;
      const x = level.scatter[k]!;
      const z = level.scatter[k + 1]!;
      const scale = level.scatter[k + 2]!;
      q.setFromAxisAngle(up, level.scatter[k + 3]!);
      m.compose(p.set(x, heights.heightAt(x, z) - 0.1, z), q, s.setScalar(scale));
      trunks.setMatrixAt(i, m);
      canopies.setMatrixAt(i, m);
    }
    trunks.name = `${species.name}-trunks`;
    canopies.name = `${species.name}-canopies`;
    group.add(trunks, canopies);
  }
  return group;
}
