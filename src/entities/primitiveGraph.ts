import * as THREE from "three";

/**
 * The runtime half of `docs/ASSET_PIPELINE.md` section 4: Blender is a *design* tool for playable
 * assets, and only parameters cross the line into the game. A graph is authored in Blender, walked
 * by the section 4.3 exporter into `graphs/*.json`, and assembled here. No mesh data is involved at
 * any point, so `AGENTS.md`'s procedural-primitives rule holds intact.
 *
 * The types below are section 4.1 verbatim. Keep them that way: the Python exporter emits this
 * shape, and a field renamed on one side without the other produces a graph that parses and builds
 * the wrong cart.
 *
 * **One material per slot, shared by every node using it.** Section 9 is explicit that material
 * count and draw calls matter far more than triangle count here, and it is what makes a chassis
 * repaint a single `color.setHex()` instead of a tree walk -- which is the entire mechanism the
 * clubhouse loadout drives (`UI-SPEC.md` S3).
 */

export type PrimitiveKind = "box" | "cylinder" | "cone" | "sphere" | "capsule" | "torus";

export interface PrimitiveNode {
  readonly name: string;
  readonly kind: PrimitiveKind;
  /** Kind-specific, in the same order as the matching THREE geometry constructor. Section 4.2. */
  readonly params: readonly number[];
  readonly position: readonly [number, number, number];
  /** Euler XYZ, radians. */
  readonly rotation: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
  /** Material slot name. Must exist in the graph's `slots`. */
  readonly slot: string;
  readonly children?: readonly PrimitiveNode[];
}

export interface SlotSpec {
  readonly color: number; // 0xRRGGBB
  readonly roughness: number;
  readonly metalness: number;
}

export interface PrimitiveGraph {
  readonly name: string;
  readonly version: 1;
  readonly units: "m";
  readonly slots: Readonly<Record<string, SlotSpec>>;
  readonly root: PrimitiveNode;
}

/** Slot name to 0xRRGGBB. The loadout's cosmetics resolve to exactly this. */
export type SlotColors = Readonly<Record<string, number>>;

export interface BuiltGraph {
  readonly root: THREE.Object3D;
  /** Every node by its authored name, so callers address pivots by name instead of tree position. */
  readonly named: ReadonlyMap<string, THREE.Object3D>;
  /** Repaints every node in a slot at once. Unknown slots are ignored, not an error: a cosmetic
   *  referring to a slot this graph does not have should degrade, never throw mid-frame. */
  setSlotColor(slot: string, color: number): void;
  /** Frees every geometry and every slot material. See the AGENTS.md resource-cleanup rule. */
  dispose(): void;
}

/**
 * `slotOverrides` is applied at build time so a cart can be assembled already wearing its paint,
 * without a repaint pass on the first frame.
 */
export function buildGraph(graph: PrimitiveGraph, slotOverrides: SlotColors = {}): BuiltGraph {
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const named = new Map<string, THREE.Object3D>();
  const geometries: THREE.BufferGeometry[] = [];

  const materialFor = (slot: string): THREE.MeshStandardMaterial => {
    const existing = materials.get(slot);
    if (existing) return existing;

    const spec = graph.slots[slot];
    if (!spec) {
      throw new Error(
        `primitive graph "${graph.name}": node uses slot "${slot}", which the graph does not declare ` +
          `(have: ${Object.keys(graph.slots).join(", ")})`,
      );
    }
    const material = new THREE.MeshStandardMaterial({
      color: slotOverrides[slot] ?? spec.color,
      roughness: spec.roughness,
      metalness: spec.metalness,
    });
    material.name = slot;
    materials.set(slot, material);
    return material;
  };

  const build = (spec: PrimitiveNode): THREE.Mesh => {
    const geometry = geometryFor(spec, graph.name);
    geometries.push(geometry);

    const mesh = new THREE.Mesh(geometry, materialFor(spec.slot));
    mesh.name = spec.name;
    mesh.position.set(spec.position[0], spec.position[1], spec.position[2]);
    mesh.rotation.set(spec.rotation[0], spec.rotation[1], spec.rotation[2]);
    mesh.scale.set(spec.scale[0], spec.scale[1], spec.scale[2]);

    if (named.has(spec.name)) {
      throw new Error(`primitive graph "${graph.name}": duplicate node name "${spec.name}"`);
    }
    named.set(spec.name, mesh);

    // Children hang off their own parent, never off the root: the turret pivot has to carry the
    // barrel with it when it yaws, and a flattened tree looks correct until something rotates.
    for (const child of spec.children ?? []) mesh.add(build(child));
    return mesh;
  };

  const root = build(graph.root);

  return {
    root,
    named,
    setSlotColor(slot: string, color: number): void {
      materials.get(slot)?.color.setHex(color);
    },
    dispose(): void {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials.values()) material.dispose();
    },
  };
}

/**
 * Section 4.2's parameter order matches the THREE constructors exactly, which is the point of that
 * table: this is a `switch` with no translation layer, and adding one would be the place a
 * Blender-authored number silently becomes a different number in the game.
 */
function geometryFor(node: PrimitiveNode, graphName: string): THREE.BufferGeometry {
  const p = node.params;
  switch (node.kind) {
    case "box":
      return new THREE.BoxGeometry(p[0], p[1], p[2]);
    case "cylinder":
      return new THREE.CylinderGeometry(p[0], p[1], p[2], p[3]);
    case "cone":
      return new THREE.ConeGeometry(p[0], p[1], p[2]);
    case "sphere":
      return new THREE.SphereGeometry(p[0], p[1], p[2]);
    case "capsule":
      return new THREE.CapsuleGeometry(p[0], p[1], p[2], p[3]);
    case "torus":
      return new THREE.TorusGeometry(p[0], p[1], p[2], p[3]);
    default:
      throw new Error(
        `primitive graph "${graphName}": node "${node.name}" has unknown kind "${String(node.kind)}"`,
      );
  }
}
