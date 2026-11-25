import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { color, vertexColor } from 'three/tsl';
import { envConfig } from '../env/envConfig';

/** Gray-box terrain: per-vertex material color from the packet palette (TSL). */
export function createTerrainMaterial(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ roughness: envConfig.terrain.roughness, metalness: 0 });
  material.colorNode = vertexColor();
  return material;
}

/** Debug overlay drawn on top of the terrain triangles (?debug=1). */
export function createTerrainWireframeMaterial(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ wireframe: true, transparent: true, opacity: 0.35, depthWrite: false });
  material.colorNode = color(envConfig.terrain.wireframeColor);
  return material;
}
