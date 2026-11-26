import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
  type Object3D,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
} from 'three/webgpu';
import { roundedBoxGeometry } from './roundedBox';

/*
 * The WebGPU twin of TeeTimeTurrets' src/entities/primitiveGraph.ts (buildGraph and drawBySlot),
 * for the Turrets cart and rider graphs. That module imports 'three' and a three addon, and
 * importing it here would load a second three core beside three/webgpu, so the graph JSON is
 * shared and the builder is drive's own. test/vehicle/cartGraphParity.test.ts builds both and
 * compares them, so the two cannot drift apart.
 *
 * Parameter order per kind is the THREE constructor's, as in primitiveGraph.ts. Each slot is one
 * MeshStandardNodeMaterial shared by every node in it, so a repaint is one colour write.
 */

export type PrimitiveKind = 'box' | 'rbox' | 'cylinder' | 'cone' | 'sphere' | 'capsule' | 'torus' | 'prism';

export interface PrimitiveNode {
  readonly name: string;
  readonly kind: PrimitiveKind;
  readonly params: readonly number[];
  readonly position: readonly [number, number, number];
  /** Euler XYZ, radians. */
  readonly rotation: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
  readonly slot: string;
  readonly children?: readonly PrimitiveNode[] | null;
}

export interface SlotSpec {
  readonly color: number;
  readonly roughness: number;
  readonly metalness: number;
  readonly flat?: boolean;
}

export interface PrimitiveGraph {
  readonly name: string;
  readonly version: 1;
  readonly units: 'm';
  readonly slots: Readonly<Record<string, SlotSpec>>;
  readonly root: PrimitiveNode;
}

export interface BuiltGraph {
  readonly root: Mesh;
  /** Every node by its authored name. */
  readonly named: ReadonlyMap<string, Mesh>;
  readonly materials: ReadonlyMap<string, MeshStandardNodeMaterial>;
  /** Repaints a slot; an unknown slot is ignored. */
  setSlotColor(slot: string, color: number): void;
  /** Frees every node geometry and every slot material. */
  dispose(): void;
}

export function buildGraph(graph: PrimitiveGraph, slotOverrides: Readonly<Record<string, number>> = {}): BuiltGraph {
  const materials = new Map<string, MeshStandardNodeMaterial>();
  const named = new Map<string, Mesh>();
  const geometries: BufferGeometry[] = [];

  const materialFor = (slot: string): MeshStandardNodeMaterial => {
    const existing = materials.get(slot);
    if (existing) return existing;
    const spec = graph.slots[slot];
    if (!spec) {
      throw new Error(
        `primitive graph "${graph.name}": node uses slot "${slot}", which the graph does not declare ` +
          `(have: ${Object.keys(graph.slots).join(', ')})`,
      );
    }
    const material = new MeshStandardNodeMaterial({
      color: slotOverrides[slot] ?? spec.color,
      roughness: spec.roughness,
      metalness: spec.metalness,
      flatShading: spec.flat === true,
    });
    material.name = slot;
    materials.set(slot, material);
    return material;
  };

  const build = (spec: PrimitiveNode): Mesh => {
    const geometry = geometryFor(spec, graph.name);
    geometries.push(geometry);
    const mesh = new Mesh(geometry, materialFor(spec.slot));
    mesh.name = spec.name;
    mesh.position.set(spec.position[0], spec.position[1], spec.position[2]);
    mesh.rotation.set(spec.rotation[0], spec.rotation[1], spec.rotation[2]);
    mesh.scale.set(spec.scale[0], spec.scale[1], spec.scale[2]);
    if (named.has(spec.name)) throw new Error(`primitive graph "${graph.name}": duplicate node name "${spec.name}"`);
    named.set(spec.name, mesh);
    for (const child of spec.children ?? []) mesh.add(build(child));
    return mesh;
  };

  const root = build(graph.root);
  return {
    root,
    named,
    materials,
    setSlotColor(slot, color) {
      materials.get(slot)?.color.setHex(color);
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials.values()) m.dispose();
    },
  };
}

/** The layer a drawn graph's own node meshes move to: kept for posing and measuring, never drawn. */
export const RIG_LAYER = 31;

export interface SlotDraw {
  readonly meshes: readonly Mesh[];
  /** Detaches the meshes and frees their merged geometry. */
  dispose(): void;
}

/**
 * Draws a built graph as one mesh per material slot per posed part. Each node is baked into the
 * frame of its nearest posed ancestor (or the root) and merged with that part's other nodes in
 * the same slot; the merged mesh hangs under the posed node, so it follows the pose. A node that
 * moves but is not in `posed` would be drawn frozen at rest.
 */
export function drawBySlot(built: BuiltGraph, posed: readonly string[]): SlotDraw {
  const posedSet = new Set(posed);
  built.root.updateMatrixWorld(true);
  const groups = new Map<string, { anchor: Mesh; slot: string; parts: BufferGeometry[] }>();
  const inverse = new Matrix4();
  const relative = new Matrix4();

  built.root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    let anchor: Object3D = mesh;
    while (anchor !== built.root && !posedSet.has(anchor.name)) anchor = anchor.parent!;
    inverse.copy(anchor.matrixWorld).invert();
    relative.multiplyMatrices(inverse, mesh.matrixWorld);
    const slot = (mesh.material as MeshStandardNodeMaterial).name;
    const key = `${anchor.name}|${slot}`;
    let group = groups.get(key);
    if (!group) {
      group = { anchor: anchor as Mesh, slot, parts: [] };
      groups.set(key, group);
    }
    group.parts.push(mesh.geometry.clone().applyMatrix4(relative));
  });

  const meshes: Mesh[] = [];
  const merged: BufferGeometry[] = [];
  for (const group of groups.values()) {
    const geometry = mergeIndexed(group.parts);
    for (const p of group.parts) p.dispose();
    merged.push(geometry);
    const mesh = new Mesh(geometry, built.materials.get(group.slot)!);
    mesh.name = `merged:${group.anchor.name}:${group.slot}`;
    group.anchor.add(mesh);
    meshes.push(mesh);
  }
  for (const node of built.named.values()) node.layers.set(RIG_LAYER);

  let disposed = false;
  return {
    meshes,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const m of meshes) m.removeFromParent();
      for (const g of merged) g.dispose();
    },
  };
}

/** Concatenates indexed parts, keeping position, normal and index (no BufferGeometryUtils: it imports 'three'). */
function mergeIndexed(parts: readonly BufferGeometry[]): BufferGeometry {
  let vertices = 0;
  let indices = 0;
  for (const p of parts) {
    if (!p.index) throw new Error('cartGraph: parts must be indexed');
    vertices += p.getAttribute('position').count;
    indices += p.index.count;
  }
  const position = new Float32Array(vertices * 3);
  const normal = new Float32Array(vertices * 3);
  const index = new Uint32Array(indices);
  let v = 0;
  let k = 0;
  for (const p of parts) {
    const pos = p.getAttribute('position');
    const nor = p.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) {
      const o = (v + i) * 3;
      position[o] = pos.getX(i);
      position[o + 1] = pos.getY(i);
      position[o + 2] = pos.getZ(i);
      normal[o] = nor.getX(i);
      normal[o + 1] = nor.getY(i);
      normal[o + 2] = nor.getZ(i);
    }
    const idx = p.index!;
    for (let i = 0; i < idx.count; i++) index[k + i] = v + idx.getX(i);
    v += pos.count;
    k += idx.count;
  }
  const merged = new BufferGeometry();
  merged.setAttribute('position', new BufferAttribute(position, 3));
  merged.setAttribute('normal', new BufferAttribute(normal, 3));
  merged.setIndex(new BufferAttribute(index, 1));
  merged.computeBoundingSphere();
  return merged;
}

function geometryFor(node: PrimitiveNode, graphName: string): BufferGeometry {
  const p = node.params;
  switch (node.kind) {
    case 'box':
      return new BoxGeometry(p[0], p[1], p[2]);
    case 'rbox':
      return roundedBox(node, graphName);
    case 'cylinder':
      return new CylinderGeometry(p[0], p[1], p[2], p[3]);
    case 'cone':
      return new ConeGeometry(p[0], p[1], p[2]);
    case 'sphere':
      return new SphereGeometry(p[0], p[1], p[2]);
    case 'capsule':
      return new CapsuleGeometry(p[0], p[1], p[2], p[3]);
    case 'torus':
      return new TorusGeometry(p[0], p[1], p[2], p[3]);
    case 'prism':
      return prism(node, graphName);
    default:
      throw new Error(`primitive graph "${graphName}": node "${node.name}" has unknown kind "${String(node.kind)}"`);
  }
}

/** `rbox`: [w, h, d, radius], one rounding segment. The radius is checked, not clamped. */
function roundedBox(node: PrimitiveNode, graphName: string): BufferGeometry {
  const [w = 0, h = 0, d = 0, radius = 0] = node.params;
  if (node.params.length !== 4 || !(w > 0 && h > 0 && d > 0) || !(radius > 0 && radius < Math.min(w, h, d) / 2)) {
    throw new Error(
      `primitive graph "${graphName}": rbox "${node.name}" needs [w, h, d > 0, 0 < radius < half the ` +
        `shortest side] (got [${node.params.join(', ')}])`,
    );
  }
  const geometry = roundedBoxGeometry(w, h, d, 1, radius);
  geometry.clearGroups();
  return withSequentialIndex(geometry);
}

/** `prism`: [depth, x0, y0, x1, y1, ...], a local-XY polygon extruded along +Z and centred on z. */
function prism(node: PrimitiveNode, graphName: string): BufferGeometry {
  const p = node.params;
  const depth = p[0] ?? 0;
  const coords = p.length - 1;
  if (!(depth > 0) || coords < 6 || coords % 2 !== 0) {
    throw new Error(
      `primitive graph "${graphName}": prism "${node.name}" needs [depth > 0, x0, y0, ...] with at ` +
        `least three points (got ${p.length} params, depth ${depth})`,
    );
  }
  const points: Vector2[] = [];
  for (let i = 1; i < p.length; i += 2) points.push(new Vector2(p[i], p[i + 1]));
  const geometry = new ExtrudeGeometry(new Shape(points), { depth, bevelEnabled: false, steps: 1 });
  geometry.translate(0, 0, -depth / 2);
  geometry.clearGroups();
  return withSequentialIndex(geometry);
}

function withSequentialIndex(geometry: BufferGeometry): BufferGeometry {
  const count = geometry.getAttribute('position').count;
  const index = new Uint32Array(count);
  for (let i = 0; i < count; i++) index[i] = i;
  geometry.setIndex(new BufferAttribute(index, 1));
  return geometry;
}
