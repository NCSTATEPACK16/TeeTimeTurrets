import { Group, Mesh, MeshBasicNodeMaterial, Shape, ShapeGeometry, Vector2 } from 'three/webgpu';
import { cameraPosition, positionWorld } from 'three/tsl';
import type { Level } from '../level/loadLevel';
import { waterColor } from './oceanWaves';

/**
 * One flat surface per body at its level, shaded by the Shadertoy ocean port (env/oceanWaves.ts).
 * Unlit and opaque, like the original: its light is the sky reflection, sun and scattering terms.
 * Not a collider.
 */
export function createWater(level: Level): Group {
  const group = new Group();
  group.name = 'water';
  const material = new MeshBasicNodeMaterial();
  material.colorNode = waterColor(positionWorld, cameraPosition);
  for (const body of level.course.water) {
    // Shape lives in XY; rotating -90 degrees about X maps shape (x, y) to world (x, -y), so use y = -z.
    const shape = new Shape(body.polygon.map(([x, z]) => new Vector2(x, -z)));
    const geometry = new ShapeGeometry(shape);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new Mesh(geometry, material);
    mesh.position.y = body.level;
    mesh.name = `water-${body.id}`;
    group.add(mesh);
  }
  return group;
}
