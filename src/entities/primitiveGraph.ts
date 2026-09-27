import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

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

export interface MergedGraph {
  /** The whole graph, as one mesh and one draw call. */
  readonly mesh: THREE.Mesh;
  /** Frees the merged geometry and its single material. See the AGENTS.md resource-cleanup rule. */
  dispose(): void;
}

/**
 * The whole graph flattened into one geometry with baked vertex colours: one draw call instead of
 * one per node.
 *
 * `ASSET_PIPELINE.md` §9 is explicit that draw calls and material count matter far more than
 * triangle count. A cart is 78 `Object3D`s and a round draws five of them; seven graph-authored
 * props at roughly five nodes each, a dozen instances to a hole, is another ~60 draws before this
 * and about 12 after it.
 *
 * **It costs per-slot recolouring, so the cart must never be drawn with this. That is a rule, not
 * a preference.** Merging bakes each node's colour into the vertices, so there is no material left
 * to `setSlotColor` on -- a merged cart would lose the clubhouse loadout with it (`UI-SPEC.md` S3).
 * Props do not need repainting, which is why this suits them; the cart's own draw-call fix is
 * `mergeGraphBySlot`, which keeps a material per slot.
 *
 * Node names do not survive either, for the same reason: there is nothing left to address. A graph
 * with a pivot something poses by name belongs in `buildGraph`.
 */
export function mergeGraph(graph: PrimitiveGraph, slotOverrides: SlotColors = {}): MergedGraph {
  // Built with `buildGraph` rather than by walking the tree again, so the transforms, the slot
  // lookup and the parameter mapping are the *same* code the unmerged path uses. A second walk
  // here is exactly where a merged prop would quietly stop matching its own gate subject.
  const built = buildGraph(graph, slotOverrides);
  const parts: THREE.BufferGeometry[] = [];
  const colours: number[] = [];

  bakeInto(built, null, parts, colours);
  built.dispose();

  return meshFrom(graph.name, parts, colours);
}

/**
 * The same flattening, applied to **n placed copies** of one graph, and still one draw call.
 *
 * This exists for objects whose *length* is a property of the world rather than of the asset. The
 * causeway is the case that needed it: a crossing spans whatever the pond is wide, so the boardwalk
 * is one authored section tiled along it, and tiling with `mergeGraph` would spend a draw call per
 * section -- fifteen of `MAX_PROPS_PER_HOLE`'s twenty on a single object.
 *
 * Each instance carries **its own full matrix**, not a shared stride. A causeway's sections do not
 * sit at one height: the deck runs onto dry bank at both ends and the abutments land wherever the
 * bank happens to be, so the caller samples the terrain per section and hands the results in.
 *
 * The graph is built and posed **once** and its geometries cloned per instance, so n sections cost
 * one `buildGraph`. Everything `mergeGraph`'s docstring says about the cost still holds: no slot
 * recolouring and no node names survive.
 */
export function mergeGraphInstances(
  graph: PrimitiveGraph,
  instances: readonly THREE.Matrix4[],
  slotOverrides: SlotColors = {},
): MergedGraph {
  if (instances.length === 0) {
    throw new Error(`primitive graph "${graph.name}": needs at least one instance matrix`);
  }

  const built = buildGraph(graph, slotOverrides);
  const parts: THREE.BufferGeometry[] = [];
  const colours: number[] = [];

  for (const instance of instances) bakeInto(built, instance, parts, colours);
  built.dispose();

  return meshFrom(graph.name, parts, colours);
}

/**
 * Walks a posed graph and appends each node's world-space geometry and its slot colour.
 *
 * Shared by both merges rather than written twice, which is the same rule `mergeGraph` follows in
 * calling `buildGraph`: a second walk is exactly where a tiled prop would quietly stop matching the
 * single one its own gate subject draws.
 */
function bakeInto(
  built: BuiltGraph,
  instance: THREE.Matrix4 | null,
  parts: THREE.BufferGeometry[],
  colours: number[],
): void {
  built.root.updateMatrixWorld(true);
  const rgb = new THREE.Color();

  built.root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    // Baked into world space: the merged mesh has no tree left to carry a node's parent transform,
    // so each node's own matrix has to be applied before its vertices are concatenated.
    const geometry = child.geometry.clone().applyMatrix4(child.matrixWorld);
    // And then the instance's own placement on top of it, which is what makes copy n land somewhere
    // copy 0 does not.
    if (instance !== null) geometry.applyMatrix4(instance);
    parts.push(geometry);

    rgb.copy((child.material as THREE.MeshStandardMaterial).color);
    const count = geometry.getAttribute("position").count;
    for (let i = 0; i < count; i++) colours.push(rgb.r, rgb.g, rgb.b);
  });
}

/** Concatenates the baked parts into the single vertex-coloured mesh both merges return. */
function meshFrom(name: string, parts: THREE.BufferGeometry[], colours: number[]): MergedGraph {
  const merged = mergeGeometries(parts, false);
  // Freed the moment they have been copied in, as `Trees.ts` does: the sources are scratch.
  for (const part of parts) part.dispose();
  if (merged === null) {
    throw new Error(`primitive graph "${name}": geometries failed to merge`);
  }
  merged.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    flatShading: true,
  });
  const mesh = new THREE.Mesh(merged, material);
  mesh.name = name;

  return {
    mesh,
    dispose(): void {
      merged.dispose();
      material.dispose();
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

/** Which nodes of a graph `mergeGraphBySlot` must keep apart. */
export interface SlotMergeFrames {
  /**
   * Nodes posed or hidden at runtime: the turret's yaw, the barrel's loft, the swing, the club
   * heads toggled by `visible`. Each is a rigid part with meshes of its own, so moving it moves
   * exactly what hangs off it.
   */
  readonly moving: readonly string[];
  /**
   * Nodes something is attached to at runtime but which never move against their parent -- the
   * club head's socket the loaded ball rides in. Kept addressable; drawn with their part's meshes.
   */
  readonly anchors?: readonly string[];
}

/** One kept node of a merged graph: its authored local transform and where it hangs. */
interface KeptNode {
  readonly name: string;
  /** Index of the kept parent in `kept`; -1 for the root. */
  readonly parent: number;
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  readonly scale: THREE.Vector3;
}

/** The geometry every build of one graph with one set of frames shares. */
interface SlotMergeTemplate {
  readonly kept: readonly KeptNode[];
  /** One merged mesh per (part, slot): `part` indexes `kept`. */
  readonly parts: readonly { readonly part: number; readonly slot: string; readonly geometry: THREE.BufferGeometry }[];
  users: number;
}

const slotMergeTemplates = new WeakMap<PrimitiveGraph, Map<string, SlotMergeTemplate>>();

/**
 * The graph with its rigid parts merged: **one mesh per material slot per rigid part**, where
 * `buildGraph` makes one per node. This is the cart's draw-call fix (`REVAMP-PLAN.md` Stage 3).
 *
 * A rigid part is the root or a node named in `frames.moving`, together with every descendant that
 * does not start a part of its own. Everything in a part is merged, per slot, into that part's own
 * space, so posing a moving node moves its meshes exactly as it moved its nodes.
 *
 * What survives, and why:
 *
 * - **Per-slot materials.** One material per slot per build, shared by every part that draws the
 *   slot, so `setSlotColor` is the same single write it is on `buildGraph` and the clubhouse loadout
 *   keeps working. This is what `mergeGraph` cannot offer.
 * - **The moving nodes, the anchors, and every node between them and the root**, as plain
 *   `Object3D`s carrying their authored local transform. The chain matters: the cart's swing arm
 *   hangs off a tilted yoke nothing poses, and folding the yoke into the arm would fold its tilt
 *   into the arm's own rotation, where a swing written to `rotation.x` overwrites it. Kept as it
 *   was authored, `rotation.x` on the arm means what it meant unmerged. `named` holds these nodes
 *   and no others.
 *
 * The geometry is built once per graph and set of frames and **shared by every build**, reference
 * counted: eight carts draw one set of buffers, and the last build's `dispose` frees them. Each
 * build owns only its materials.
 */
export function mergeGraphBySlot(
  graph: PrimitiveGraph,
  frames: SlotMergeFrames,
  slotOverrides: SlotColors = {},
): BuiltGraph {
  const template = acquireSlotMergeTemplate(graph, frames);
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const named = new Map<string, THREE.Object3D>();

  const objects = template.kept.map((spec) => {
    const object = new THREE.Object3D();
    object.name = spec.name;
    object.position.copy(spec.position);
    object.quaternion.copy(spec.quaternion);
    object.scale.copy(spec.scale);
    named.set(spec.name, object);
    return object;
  });
  template.kept.forEach((spec, i) => {
    if (spec.parent >= 0) objects[spec.parent]!.add(objects[i]!);
  });

  for (const { part, slot, geometry } of template.parts) {
    let material = materials.get(slot);
    if (!material) {
      const spec = graph.slots[slot]!;
      material = new THREE.MeshStandardMaterial({
        color: slotOverrides[slot] ?? spec.color,
        roughness: spec.roughness,
        metalness: spec.metalness,
      });
      material.name = slot;
      materials.set(slot, material);
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `${template.kept[part]!.name}:${slot}`;
    objects[part]!.add(mesh);
  }

  let disposed = false;
  return {
    root: objects[0]!,
    named,
    setSlotColor(slot: string, color: number): void {
      materials.get(slot)?.color.setHex(color);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const material of materials.values()) material.dispose();
      releaseSlotMergeTemplate(graph, frames, template);
    },
  };
}

function slotMergeKey(frames: SlotMergeFrames): string {
  return `${[...frames.moving].sort().join(",")}|${[...(frames.anchors ?? [])].sort().join(",")}`;
}

function acquireSlotMergeTemplate(graph: PrimitiveGraph, frames: SlotMergeFrames): SlotMergeTemplate {
  let byFrames = slotMergeTemplates.get(graph);
  if (!byFrames) {
    byFrames = new Map();
    slotMergeTemplates.set(graph, byFrames);
  }
  const key = slotMergeKey(frames);
  let template = byFrames.get(key);
  if (!template) {
    template = buildSlotMergeTemplate(graph, frames);
    byFrames.set(key, template);
  }
  template.users++;
  return template;
}

function releaseSlotMergeTemplate(graph: PrimitiveGraph, frames: SlotMergeFrames, template: SlotMergeTemplate): void {
  template.users--;
  if (template.users > 0) return;
  for (const { geometry } of template.parts) geometry.dispose();
  slotMergeTemplates.get(graph)?.delete(slotMergeKey(frames));
}

function buildSlotMergeTemplate(graph: PrimitiveGraph, frames: SlotMergeFrames): SlotMergeTemplate {
  // Built with `buildGraph`, as `mergeGraph` is, so the transforms, the slot lookup and the
  // parameter mapping are the same code the unmerged cart ran.
  const built = buildGraph(graph);
  const moving = new Set(frames.moving);
  const anchors = new Set(frames.anchors ?? []);
  for (const name of [...moving, ...anchors]) {
    if (!built.named.has(name)) {
      built.dispose();
      throw new Error(
        `primitive graph "${graph.name}": frame "${name}" is not in the graph. Re-export from Blender ` +
          `with that node present, or update the frames if it was deliberately renamed.`,
      );
    }
  }

  // Kept: the root, every moving node and anchor, and every ancestor of one.
  const keep = new Set<THREE.Object3D>([built.root]);
  for (const name of [...moving, ...anchors]) {
    for (let node: THREE.Object3D | null = built.named.get(name)!; node !== null && !keep.has(node); node = node.parent) {
      keep.add(node);
    }
  }

  built.root.updateMatrixWorld(true);
  const kept: KeptNode[] = [];
  /** The unmerged node each entry of `kept` came from, for its world matrix. */
  const keptNodes: THREE.Object3D[] = [];
  const keptIndex = new Map<THREE.Object3D, number>();
  // Per part, per slot: the part-space geometries to merge. Insertion order is walk order, so two
  // builds of one graph lay their meshes out identically.
  const pending = new Map<number, Map<string, THREE.BufferGeometry[]>>();
  const toPart = new THREE.Matrix4();

  const walk = (node: THREE.Object3D, part: number): void => {
    let own = part;
    if (keep.has(node)) {
      keptIndex.set(node, kept.length);
      keptNodes.push(node);
      kept.push({
        name: node.name,
        parent: node === built.root ? -1 : keptIndex.get(node.parent!)!,
        position: node.position.clone(),
        quaternion: node.quaternion.clone(),
        scale: node.scale.clone(),
      });
      // Only a moving node (or the root) starts a part: an anchor or a link in the chain never moves
      // against its parent, so its geometry is drawn with the part it rides in.
      if (node === built.root || moving.has(node.name)) own = kept.length - 1;
    }

    const mesh = node as THREE.Mesh;
    const slot = (mesh.material as THREE.Material).name;
    // The node's vertices in its part's space: the node's world matrix, then the part's undone.
    toPart.copy(keptNodes[own]!.matrixWorld).invert().multiply(node.matrixWorld);
    let slots = pending.get(own);
    if (!slots) pending.set(own, (slots = new Map()));
    let list = slots.get(slot);
    if (!list) slots.set(slot, (list = []));
    list.push(mesh.geometry.clone().applyMatrix4(toPart));

    for (const child of node.children) walk(child, own);
  };
  walk(built.root, 0);

  const parts: { part: number; slot: string; geometry: THREE.BufferGeometry }[] = [];
  for (const [part, slots] of pending) {
    for (const [slot, list] of slots) {
      const merged = list.length === 1 ? list[0]! : mergeGeometries(list, false);
      if (list.length > 1) for (const g of list) g.dispose();
      if (merged === null) throw new Error(`primitive graph "${graph.name}": geometries failed to merge`);
      parts.push({ part, slot, geometry: merged });
    }
  }
  built.dispose();
  return { kept, parts, users: 0 };
}
