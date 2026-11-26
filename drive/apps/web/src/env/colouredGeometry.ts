import { BufferAttribute, BufferGeometry, Color, type Matrix4 } from 'three/webgpu';

export interface ColouredPart {
  geometry: BufferGeometry;
  /** sRGB hex, e.g. '#fff4dc' or 0x5e3f24. */
  color: string | number;
  /** Applied before merging; the part's geometry is left as it was. */
  matrix?: Matrix4;
}

/**
 * Merges indexed parts into one geometry with a per-vertex `color` attribute, so solids of several
 * colours draw in one call under a `vertexColors` material. Keeps position, normal and index only.
 * The parts are not disposed; the caller owns them.
 */
export function mergeColoured(parts: readonly ColouredPart[]): BufferGeometry {
  let vertices = 0;
  let indices = 0;
  for (const p of parts) {
    if (!p.geometry.index) throw new Error('mergeColoured: parts must be indexed');
    vertices += p.geometry.getAttribute('position').count;
    indices += p.geometry.index.count;
  }
  const position = new Float32Array(vertices * 3);
  const normal = new Float32Array(vertices * 3);
  const color = new Float32Array(vertices * 3);
  const index = new Uint32Array(indices);
  const c = new Color();
  let v = 0;
  let k = 0;
  for (const p of parts) {
    const g = p.matrix ? p.geometry.clone().applyMatrix4(p.matrix) : p.geometry;
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    c.set(p.color);
    for (let i = 0; i < pos.count; i++) {
      position.set([pos.getX(i), pos.getY(i), pos.getZ(i)], (v + i) * 3);
      normal.set([nor.getX(i), nor.getY(i), nor.getZ(i)], (v + i) * 3);
      color.set([c.r, c.g, c.b], (v + i) * 3);
    }
    const idx = g.index!;
    for (let i = 0; i < idx.count; i++) index[k + i] = v + idx.getX(i);
    v += pos.count;
    k += idx.count;
    if (g !== p.geometry) g.dispose();
  }
  const merged = new BufferGeometry();
  merged.setAttribute('position', new BufferAttribute(position, 3));
  merged.setAttribute('normal', new BufferAttribute(normal, 3));
  merged.setAttribute('color', new BufferAttribute(color, 3));
  merged.setIndex(new BufferAttribute(index, 1));
  merged.computeBoundingSphere();
  return merged;
}
