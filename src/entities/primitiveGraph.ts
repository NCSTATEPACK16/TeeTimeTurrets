import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

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

export type PrimitiveKind = "box" | "rbox" | "cylinder" | "cone" | "sphere" | "capsule" | "torus" | "prism";

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
  /**
   * Facet this slot. Smooth is the default (`docs/art/specs/00-pipeline.md`, Style): every kind's
   * own normals are already smooth inside a part and crisp where its faces turn a corner, which is
   * the soft-bevelled look. `flat` is the opt-in for a slot that should read faceted.
   */
  readonly flat?: boolean;
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
  /** One material per slot, shared by every node in it. */
  readonly materials: ReadonlyMap<string, THREE.MeshStandardMaterial>;
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
      flatShading: spec.flat === true,
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
    materials,
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
 * The layer a built graph's own meshes are moved to once `drawBySlot` draws it instead. A camera
 * renders layer 0 only, and three still walks the children of an object it does not draw, so the
 * rig keeps every node, name, transform and geometry -- for posing, and for tests that measure a
 * part -- and costs no draw calls.
 */
export const RIG_LAYER = 31;

export interface SlotDraw {
  /** The drawn meshes, each already added under the node it moves with. */
  readonly meshes: readonly THREE.Mesh[];
  /** Detaches the meshes and frees the shared geometry once no other copy of the graph uses it. */
  dispose(): void;
}

interface SlotDrawCache {
  readonly parts: readonly { readonly anchor: string; readonly slot: string; readonly geometry: THREE.BufferGeometry }[];
  refs: number;
}

const slotDrawCache = new Map<string, SlotDrawCache>();

/**
 * Draws a built graph with one mesh per material slot per posed part, rather than one per node.
 *
 * `posed` names every node something moves, turns or hides at runtime. Each node's geometry is
 * baked into the frame of its nearest posed ancestor (or the graph root) and merged with the rest
 * of that part's nodes in the same slot; the merged mesh is hung under the posed node, so it
 * follows the pose exactly as its primitives did. A node that moves but is not listed would be
 * frozen at rest -- the caller's list is the contract.
 *
 * **Unlike `mergeGraph`, slot recolouring survives**: each merged mesh uses the built graph's own
 * slot material, so `setSlotColor` repaints it. That is what makes this usable on the cart.
 *
 * The merged geometry depends only on the graph and `posed`, so every copy of the graph shares it
 * and it is freed when the last copy is disposed. The built graph's own meshes move to
 * `RIG_LAYER`: kept, never drawn.
 */
export function drawBySlot(
  graph: PrimitiveGraph,
  built: BuiltGraph,
  posed: readonly string[],
): SlotDraw {
  const key = `${graph.name}|${posed.join(",")}`;
  let cached = slotDrawCache.get(key);
  if (cached === undefined) {
    cached = { parts: mergeBySlot(built, new Set(posed)), refs: 0 };
    slotDrawCache.set(key, cached);
  }
  cached.refs++;

  const meshes: THREE.Mesh[] = [];
  for (const part of cached.parts) {
    const anchor = part.anchor === "" ? built.root : built.named.get(part.anchor)!;
    const mesh = new THREE.Mesh(part.geometry, built.materials.get(part.slot)!);
    mesh.name = `merged:${part.anchor || graph.root.name}:${part.slot}`;
    anchor.add(mesh);
    meshes.push(mesh);
  }
  for (const node of built.named.values()) node.layers.set(RIG_LAYER);

  const entry = cached;
  let disposed = false;
  return {
    meshes,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const mesh of meshes) mesh.removeFromParent();
      entry.refs--;
      if (entry.refs > 0) return;
      for (const part of entry.parts) part.geometry.dispose();
      slotDrawCache.delete(key);
    },
  };
}

/** The merge itself, done once per graph: each node into its part's frame, grouped by slot. */
function mergeBySlot(
  built: BuiltGraph,
  posed: ReadonlySet<string>,
): { anchor: string; slot: string; geometry: THREE.BufferGeometry }[] {
  built.root.updateMatrixWorld(true);
  const groups = new Map<string, { anchor: string; slot: string; geometries: THREE.BufferGeometry[] }>();
  const inverse = new THREE.Matrix4();
  const relative = new THREE.Matrix4();

  built.root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    let anchor: THREE.Object3D = mesh;
    while (anchor !== built.root && !posed.has(anchor.name)) anchor = anchor.parent!;
    const anchorName = anchor === built.root && !posed.has(anchor.name) ? "" : anchor.name;
    // At rest, which is how the graph was just built: the frame from part to node is fixed,
    // because nothing between them is ever posed.
    inverse.copy(anchor.matrixWorld).invert();
    relative.multiplyMatrices(inverse, mesh.matrixWorld);
    const slot = (mesh.material as THREE.MeshStandardMaterial).name;
    const key = `${anchorName}|${slot}`;
    let group = groups.get(key);
    if (group === undefined) {
      group = { anchor: anchorName, slot, geometries: [] };
      groups.set(key, group);
    }
    group.geometries.push(mesh.geometry.clone().applyMatrix4(relative));
  });

  const parts: { anchor: string; slot: string; geometry: THREE.BufferGeometry }[] = [];
  for (const group of groups.values()) {
    const geometry = mergeGeometries(group.geometries, false);
    for (const g of group.geometries) g.dispose();
    if (geometry === null) throw new Error(`slot "${group.slot}" under "${group.anchor}" failed to merge`);
    parts.push({ anchor: group.anchor, slot: group.slot, geometry });
  }
  return parts;
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
 * **It costs per-slot recolouring, and the cart must keep using `buildGraph`. That is a rule, not a
 * preference.** Merging bakes each node's colour into the vertices, so there is no material left to
 * `setSlotColor` on -- a merged cart would lose the clubhouse loadout with it (`UI-SPEC.md` S3).
 * Props do not need repainting, which is why the helper is proved on them first; the carts' own
 * draw-call problem wants an instanced or per-slot-material variant of this, not this.
 *
 * Node names do not survive either, for the same reason: there is nothing left to address. A graph
 * with a pivot something poses by name belongs in `buildGraph`.
 */
export interface MergeOptions {
  /**
   * Darken the base where the graph meets the ground (`groundContactShade`). On by default, because
   * a merged graph is static dressing authored with its origin at ground contact. Off for anything
   * that floats, such as a pickup hovering over its pedestal.
   */
  readonly contactShade?: boolean;
}

export function mergeGraph(
  graph: PrimitiveGraph,
  slotOverrides: SlotColors = {},
  options: MergeOptions = {},
): MergedGraph {
  // Built with `buildGraph` rather than by walking the tree again, so the transforms, the slot
  // lookup and the parameter mapping are the *same* code the unmerged path uses. A second walk
  // here is exactly where a merged prop would quietly stop matching its own gate subject.
  const built = buildGraph(graph, slotOverrides);
  const parts: THREE.BufferGeometry[] = [];
  const colours: number[] = [];

  bakeInto(graph, built, null, parts, colours, options.contactShade !== false);
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
  options: MergeOptions = {},
): MergedGraph {
  if (instances.length === 0) {
    throw new Error(`primitive graph "${graph.name}": needs at least one instance matrix`);
  }

  const built = buildGraph(graph, slotOverrides);
  const parts: THREE.BufferGeometry[] = [];
  const colours: number[] = [];

  const shade = options.contactShade !== false;
  for (const instance of instances) bakeInto(graph, built, instance, parts, colours, shade);
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
  graph: PrimitiveGraph,
  built: BuiltGraph,
  instance: THREE.Matrix4 | null,
  parts: THREE.BufferGeometry[],
  colours: number[],
  contactShade: boolean,
): void {
  built.root.updateMatrixWorld(true);
  const rgb = new THREE.Color();

  built.root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    // Baked into world space: the merged mesh has no tree left to carry a node's parent transform,
    // so each node's own matrix has to be applied before its vertices are concatenated.
    const slot = (child.material as THREE.MeshStandardMaterial).name;
    const posed = child.geometry.clone().applyMatrix4(child.matrixWorld);
    // A merged mesh has one material, so a flat slot is faceted in its normals instead.
    const geometry = graph.slots[slot]?.flat === true ? facetted(posed) : posed;
    // The instance's own placement goes on after the shading below reads graph-space height; it is
    // what makes copy n land somewhere copy 0 does not.
    parts.push(geometry);

    rgb.copy((child.material as THREE.MeshStandardMaterial).color);
    // Graph space, before any instance placement: every merged graph is authored with its origin
    // at ground contact, so y is height above the ground it stands on.
    const position = geometry.getAttribute("position");
    for (let i = 0; i < position.count; i++) {
      const ao = contactShade ? groundContactShade(position.getY(i)) : 1;
      colours.push(rgb.r * ao, rgb.g * ao, rgb.b * ao);
    }
    if (instance !== null) geometry.applyMatrix4(instance);
  });
}

/** How dark a merged graph is where it meets the ground, and how high above it the darkening fades. */
const CONTACT_SHADE = 0.72;
const CONTACT_FADE_M = 0.6;

/**
 * Cheap ambient occlusion for static merged graphs on every preset (`STYLE-RESEARCH.md` P4): the
 * base of a building or prop darkens where it meets the ground, fading out over 0.6 m. High also
 * runs a screen-space AO pass (`post.ts`); this is what Low and Med get, baked into the vertex
 * colours at load for nothing per frame.
 */
export function groundContactShade(heightM: number): number {
  const t = Math.min(Math.max(heightM / CONTACT_FADE_M, 0), 1);
  return CONTACT_SHADE + (1 - CONTACT_SHADE) * t * t * (3 - 2 * t);
}

/** Face normals, re-indexed: `mergeGeometries` refuses to mix indexed and non-indexed parts. */
function facetted(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const flat = geometry.index === null ? geometry : geometry.toNonIndexed();
  if (flat !== geometry) geometry.dispose();
  flat.computeVertexNormals();
  return withSequentialIndex(flat);
}

function withSequentialIndex(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const count = geometry.getAttribute("position").count;
  const index: number[] = [];
  for (let i = 0; i < count; i++) index.push(i);
  geometry.setIndex(index);
  return geometry;
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

  // Smooth: a flat slot's facets are already in its normals (`bakeInto`).
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
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
    case "rbox":
      return roundedBoxGeometry(node, graphName);
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
    case "prism":
      return prismGeometry(node, graphName);
    default:
      throw new Error(
        `primitive graph "${graphName}": node "${node.name}" has unknown kind "${String(node.kind)}"`,
      );
  }
}

/**
 * `rbox`: `[w, h, d, radius]`, a box with every edge rounded -- the soft-bevelled look
 * (`docs/art/STYLE-RESEARCH.md` P2). One rounding segment: 108 triangles against a box's 12, with
 * the bevel's own smooth normals, so its edges catch a highlight line.
 *
 * The radius is checked here because `RoundedBoxGeometry` clamps a too-large one silently, which
 * would ship a different shape from the one authored. Indexed for the same reason `prism` is.
 */
function roundedBoxGeometry(node: PrimitiveNode, graphName: string): THREE.BufferGeometry {
  const [w = 0, h = 0, d = 0, radius = 0] = node.params;
  if (node.params.length !== 4 || !(w > 0 && h > 0 && d > 0) || !(radius > 0 && radius < Math.min(w, h, d) / 2)) {
    throw new Error(
      `primitive graph "${graphName}": rbox "${node.name}" needs [w, h, d > 0, 0 < radius < half the ` +
        `shortest side] (got [${node.params.join(", ")}])`,
    );
  }
  const geometry = new RoundedBoxGeometry(w, h, d, 1, radius);
  geometry.clearGroups();
  return withSequentialIndex(geometry);
}

/**
 * `prism`: `[depth, x0, y0, x1, y1, ...]`. It is a polygon in the node's local XY plane, extruded
 * along +Z by `depth` and centred on z, the same way Box and Cylinder are centred. Roofs, wedges
 * and awning scallops need it, and none of the six constructor kinds can make them without
 * non-uniform scale, which the exporter forbids (`docs/art/specs/00-pipeline.md`).
 *
 * Given an index because `ExtrudeGeometry` is non-indexed and every other kind is indexed, and
 * `mergeGeometries` refuses to mix the two. A merged roof would otherwise fail at load, not here.
 */
function prismGeometry(node: PrimitiveNode, graphName: string): THREE.BufferGeometry {
  const p = node.params;
  const depth = p[0] ?? 0;
  const coords = p.length - 1;
  if (!(depth > 0) || coords < 6 || coords % 2 !== 0) {
    throw new Error(
      `primitive graph "${graphName}": prism "${node.name}" needs [depth > 0, x0, y0, ...] with at ` +
        `least three points (got ${p.length} params, depth ${depth})`,
    );
  }
  const points: THREE.Vector2[] = [];
  for (let i = 1; i < p.length; i += 2) points.push(new THREE.Vector2(p[i], p[i + 1]));

  const geometry = new THREE.ExtrudeGeometry(new THREE.Shape(points), {
    depth,
    bevelEnabled: false,
    steps: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.clearGroups();
  return withSequentialIndex(geometry);
}
