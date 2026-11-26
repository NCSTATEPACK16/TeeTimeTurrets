/**
 * Free drive builds the Turrets cart with its own WebGPU twin of primitiveGraph.ts
 * (src/vehicle/cartGraph.ts). This builds both from the same JSON and compares node names, each
 * node's world bounding box, and the drawn triangles per slot, so the two builders cannot drift.
 * Node only: the root builder imports 'three', which must never reach the app.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import * as Root from '../../../../../src/entities/primitiveGraph';
import cartJson from '../../../../../src/entities/graphs/cart.json';
import driverJson from '../../../../../src/entities/graphs/driver.json';
import * as Drive from '../../src/vehicle/cartGraph';
import { CART_POSED } from '../../src/vehicle/CartView';

interface Summary {
  names: string[];
  boxes: Map<string, number[]>;
  /** Per node: vertex count and the sum of squared vertex distances from the node origin (the shape, not just its bounds). */
  shapes: Map<string, [number, number]>;
  triangles: Map<string, number>;
}

type AnyMesh = {
  name: string;
  isMesh?: boolean;
  geometry: {
    boundingBox: unknown;
    computeBoundingBox(): void;
    index: { count: number } | null;
    getAttribute(n: string): { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number };
  };
  matrixWorld: unknown;
};

function summarise(
  root: { updateMatrixWorld(force: boolean): void; traverse(cb: (o: unknown) => void): void },
  drawn: readonly { geometry: { index: { count: number } | null }; material: unknown }[],
  box: () => { copy(b: unknown): { applyMatrix4(m: unknown): { min: { toArray(): number[] }; max: { toArray(): number[] } } } },
): Summary {
  root.updateMatrixWorld(true);
  const names: string[] = [];
  const boxes = new Map<string, number[]>();
  const shapes = new Map<string, [number, number]>();
  root.traverse((o) => {
    const m = o as AnyMesh;
    if (!m.isMesh || m.name.startsWith('merged:')) return;
    names.push(m.name);
    m.geometry.computeBoundingBox();
    const b = box().copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld);
    boxes.set(m.name, [...b.min.toArray(), ...b.max.toArray()]);
    const pos = m.geometry.getAttribute('position');
    let moment = 0;
    for (let i = 0; i < pos.count; i++) moment += pos.getX(i) ** 2 + pos.getY(i) ** 2 + pos.getZ(i) ** 2;
    shapes.set(m.name, [pos.count, moment]);
  });
  const triangles = new Map<string, number>();
  for (const d of drawn) {
    const slot = (d.material as { name: string }).name;
    triangles.set(slot, (triangles.get(slot) ?? 0) + d.geometry.index!.count / 3);
  }
  return { names, boxes, shapes, triangles };
}

function compare(graph: Root.PrimitiveGraph, posed: readonly string[]): void {
  const a = Root.buildGraph(graph);
  const aDraw = Root.drawBySlot(graph, a, posed);
  const b = Drive.buildGraph(graph as unknown as Drive.PrimitiveGraph);
  const bDraw = Drive.drawBySlot(b, posed);
  const ra = summarise(a.root, aDraw.meshes, () => new THREE.Box3() as never);
  const rb = summarise(b.root, bDraw.meshes, () => new THREE.Box3() as never);
  expect(rb.names).toEqual(ra.names);
  for (const [name, box] of ra.boxes) {
    const other = rb.boxes.get(name)!;
    for (let i = 0; i < 6; i++) expect(other[i], `${name} box[${i}]`).toBeCloseTo(box[i]!, 5);
  }
  for (const [name, [count, moment]] of ra.shapes) {
    const [otherCount, otherMoment] = rb.shapes.get(name)!;
    expect(otherCount, `${name} vertices`).toBe(count);
    expect(otherMoment, `${name} shape`).toBeCloseTo(moment, 4);
  }
  expect(Object.fromEntries(rb.triangles)).toEqual(Object.fromEntries(ra.triangles));
  console.log(`parity ${graph.name}: ${ra.names.length} nodes, ${bDraw.meshes.length} draws, triangles ${JSON.stringify(Object.fromEntries(rb.triangles))}`);
  aDraw.dispose();
  bDraw.dispose();
  a.dispose();
  b.dispose();
}

describe('cart graph parity with Turrets', () => {
  it('the cart builds the same nodes, boxes and drawn triangles in both builders', () => {
    compare(cartJson as unknown as Root.PrimitiveGraph, CART_POSED);
  });
  it('so does the rider', () => {
    compare(driverJson as unknown as Root.PrimitiveGraph, []);
  });
});
