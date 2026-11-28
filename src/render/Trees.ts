import * as THREE from "three";
import { mergeGraph } from "../entities/primitiveGraph";
import type { PrimitiveGraph, PrimitiveNode } from "../entities/primitiveGraph";
import { TREE_SPECIES, treeGraph } from "../entities/envGraphs";
import type { SouthBoundary } from "../sim/courseBarrier";
import type { CourseTerrain } from "../sim/courseTerrain";
import type { Vec2 } from "../sim/mapGeometry";
import { hashChannel, mulberry32 } from "../sim/rng";
import { createSurfaceWeights } from "../sim/surfaces";
import type { Surfaces } from "../sim/surfaces";
import { WOODS_WEIGHT } from "../sim/terrain";
import type { Terrain } from "../sim/terrain";
import { BIOMES } from "./biomes";
import { clumpOrder, placeCourseWoods } from "./woodsPlacement";
import type { PlacedTree } from "./woodsPlacement";
import type { BiomePalette } from "./biomes";
import type { BiomeId } from "../sim/course";

/**
 * The rough's tree cover, as one instanced draw per species.
 *
 * Trees are what make a corridor read as a corridor -- without them a fairway is a colour change
 * on a field, and the concept art's sense of a mown lane cut through woodland comes almost
 * entirely from the treeline. They are also the asset most likely to wreck the frame budget if
 * done naively, which is why AGENTS.md calls out instancing for them specifically.
 *
 * Each biome has two authored species (`src/entities/envGraphs.ts`, `docs/art/specs/stage5/trees.md`),
 * so a wood is two merged geometries with baked vertex colours and two InstancedMeshes: two draw
 * calls for every tree on the hole, rather than one silhouette copied a thousand times.
 */

/** Placement grid pitch, metres. Trees are jittered within their cell rather than placed freely:
 *  a uniform random scatter clumps visibly, and a jittered grid is the cheapest fix that still
 *  looks unplanned. */
const CELL_M = 6;

/**
 * How deep into the rough a tree must be -- re-exported from the sim, not redeclared.
 *
 * `WOODS_WEIGHT` is shared with `src/sim/placement.ts`, which keeps bunkers strictly below it. Two
 * copies of this number would let sand and trees drift into the same ground.
 */
const MIN_ROUGH_WEIGHT = WOODS_WEIGHT;

/** Metres of dry land a tree needs above the water line before it will be placed. */
const MIN_FREEBOARD = 0.4;

/** Hard ceiling on instances, so a large open field cannot balloon the buffer. */
const MAX_TREES = 4000;

/** Per-instance scale spread, so a stand of trees is not eighteen copies of one silhouette. */
const SCALE_MIN = 0.75;
const SCALE_MAX = 1.3;

/** Hash channel for the species bit. A stream of its own rather than one more draw from placement's
 *  channel 3: an extra draw per tree there would shift every later cell's draws, and move the wood. */
const SPECIES_CHANNEL = 7;

/**
 * Radial segments the trees are built with, at least. The species are authored low (7-segment
 * cones, 6 x 4 spheres) from the flat-faceted era; P1 made trees smooth, and with smooth normals
 * that few sides shows as a polygon silhouette. Raised here, where the geometry is built, rather
 * than in `trees.json`, which is the Blender kit's export and is regenerated from it.
 * Thin blades (reeds) keep their four sides: nobody sees a reed's cross-section.
 */
const MIN_CONE_SEGMENTS = 14;
const MIN_TRUNK_SEGMENTS = 8;
const MIN_SPHERE_SEGMENTS: readonly [number, number] = [10, 6];
const BLADE_RADIUS_M = 0.06;

/** Wind sway at the crown, as a fraction of the tree's height. */
const SWAY_AMPLITUDE = 0.022;

/**
 * The trees' shared wind clock. Every tree material reads this one uniform, so the match scene
 * advances the woods and the treeline with one assignment (`setTreeWindTime`).
 */
const TREE_WIND = { uTreeTime: { value: 0 } };

/**
 * The sight line (Stage 5 spec, §4.2): a tree whose trunk stands within `SIGHT_RADIUS_M` of the
 * line from the camera to the player's cart, in plan, is screen-door dithered out, fading over the
 * next `SIGHT_FADE_M`. A tree within `SIGHT_CART_CLEAR_M` of the cart stays, so cover the cart is
 * hiding in still reads as cover. Shared by every tree material, like the wind clock, and set once
 * a frame by the match scene. Render-only: trees never blocked line of sight in the sim.
 */
export const SIGHT_RADIUS_M = 3;
export const SIGHT_FADE_M = 2;
export const SIGHT_CART_CLEAR_M = 4;
const TREE_SIGHT = {
  uSightFrom: { value: new THREE.Vector2() },
  uSightTo: { value: new THREE.Vector2() },
  uSightOn: { value: 0 },
};

/** The sight line from the camera to the cart, in plan. Allocation-free; call once per frame. */
export function setTreeSightLine(fromX: number, fromZ: number, toX: number, toZ: number): void {
  TREE_SIGHT.uSightFrom.value.set(fromX, fromZ);
  TREE_SIGHT.uSightTo.value.set(toX, toZ);
  TREE_SIGHT.uSightOn.value = 1;
}

/** No sight line: every tree drawn whole (the title, a dead cart). */
export function clearTreeSightLine(): void {
  TREE_SIGHT.uSightOn.value = 0;
}

/** The wind clock's uniform, for other swaying things (`grassCarpet.ts`) to bind. */
export const TREE_WIND_TIME = TREE_WIND.uTreeTime;

/** Advance every tree's sway to `seconds`. Call once per rendered frame. */
export function setTreeWindTime(seconds: number): void {
  TREE_WIND.uTreeTime.value = seconds;
}

function smoothedNode(node: PrimitiveNode): PrimitiveNode {
  const p = [...node.params];
  if (node.kind === "cone" && p[0]! >= BLADE_RADIUS_M) p[2] = Math.max(p[2]!, MIN_CONE_SEGMENTS);
  if (node.kind === "cylinder") p[3] = Math.max(p[3]!, MIN_TRUNK_SEGMENTS);
  if (node.kind === "sphere") {
    p[1] = Math.max(p[1]!, MIN_SPHERE_SEGMENTS[0]);
    p[2] = Math.max(p[2]!, MIN_SPHERE_SEGMENTS[1]);
  }
  return { ...node, params: p, children: node.children ? node.children.map(smoothedNode) : node.children };
}

/**
 * Trees this far outside the arena zone are drawn as the authored low-poly species (§4.1): no
 * one fights out there, and the camera only sees them from across the course.
 */
export const FAR_TREE_OUTSIDE_M = 60;

function smoothedGraph(graph: PrimitiveGraph): PrimitiveGraph {
  return { ...graph, root: smoothedNode(graph.root) };
}

/**
 * The trees' material: smooth-shaded (P1), with the baked vertex colours, an optional per-instance
 * tint, and a sway that grows with height up the tree. The species are authored at unit height, so
 * `transformed.y` is already 0 at the root and 1 at the crown. The phase comes from the instance's
 * own position, so neighbours move together and a wood ripples rather than beating in step.
 */
function treeMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTreeTime = TREE_WIND.uTreeTime;
    shader.uniforms.uSightFrom = TREE_SIGHT.uSightFrom;
    shader.uniforms.uSightTo = TREE_SIGHT.uSightTo;
    shader.uniforms.uSightOn = TREE_SIGHT.uSightOn;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n varying float vSightFade;")
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
         if (vSightFade > 0.0) {
           // Interleaved gradient noise: a screen-door pattern with no texture.
           float door = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
           if (door < vSightFade) discard;
         }`,
      );
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\n uniform float uTreeTime;\n uniform vec2 uSightFrom;\n uniform vec2 uSightTo;\n uniform float uSightOn;\n varying float vSightFade;",
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         {
           #ifdef USE_INSTANCING
             vec2 treeAt = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
           #else
             vec2 treeAt = vec2(0.0);
           #endif
           float bend = max(transformed.y, 0.0);
           bend *= bend;
           float phase = uTreeTime * 1.25 + dot(treeAt, vec2(0.071, 0.053));
           transformed.x += (sin(phase) + 0.35 * sin(phase * 2.3 + 1.7)) * ${SWAY_AMPLITUDE.toFixed(4)} * bend;
           transformed.z += cos(phase * 0.8) * ${(SWAY_AMPLITUDE * 0.6).toFixed(4)} * bend;

           vec2 sight = uSightTo - uSightFrom;
           float along = clamp(dot(treeAt - uSightFrom, sight) / max(dot(sight, sight), 1e-4), 0.0, 1.0);
           float off = length(treeAt - (uSightFrom + sight * along));
           float fromCart = length(treeAt - uSightTo);
           vSightFade = uSightOn
             * (1.0 - smoothstep(${SIGHT_RADIUS_M.toFixed(1)}, ${(SIGHT_RADIUS_M + SIGHT_FADE_M).toFixed(1)}, off))
             * smoothstep(${SIGHT_CART_CLEAR_M.toFixed(1)}, ${(SIGHT_CART_CLEAR_M + 1).toFixed(1)}, fromCart);
         }`,
      );
  };
  material.customProgramCacheKey = () => "ttt-trees";
  return material;
}

/**
 * The biome's two species, each merged into one geometry with the biome's colours baked in.
 *
 * Exported so `treeline.ts` grows the same trees rather than a second pair that drifts from them.
 * The horizon band beyond the road is the same species as the wood inside it, or the edge of the
 * course reads as a change of continent. Each species is authored at unit height, so the caller's
 * `palette.treeHeight` scale is the tree's height in metres.
 */
export function buildTreeGeometries(
  palette: BiomePalette,
  /** The authored segment counts instead of the smoothed ones: the far stand-in (§4.1). */
  lowPoly = false,
): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const overrides = {
    tree_trunk: palette.trunk,
    tree_foliage_dark: palette.foliageDark,
    tree_foliage_light: palette.foliageLight,
  };
  const geometryOf = (name: (typeof TREE_SPECIES)[typeof palette.treeForm][number]): THREE.BufferGeometry => {
    // No contact shade: a species is authored at unit height and scaled to metres later, so graph
    // space is not metres above the ground and the shade would darken most of the tree.
    const merged = mergeGraph(lowPoly ? treeGraph(name) : smoothedGraph(treeGraph(name)), overrides, { contactShade: false });
    // Only the geometry is kept: the instanced meshes below bring their own material.
    (merged.mesh.material as THREE.Material).dispose();
    return merged.mesh.geometry;
  };
  const [a, b] = TREE_SPECIES[palette.treeForm];
  return [geometryOf(a), geometryOf(b)];
}

export interface Trees {
  /** One per species that has at least one tree; empty when nothing was planted. */
  readonly meshes: readonly THREE.InstancedMesh[];
  readonly count: number;
  /**
   * Draw at most `cap` trees (the quality preset's `treeCap`), dropping the same share from every
   * mesh. Instances are filled in clump order (`woodsPlacement.clumpOrder`) where that matters, so
   * the ones dropped are whole clumps spread over the course. Cheap: only each mesh's draw count
   * changes, so a course dressing built once can serve every preset.
   */
  setCap(cap: number): void;
  dispose(): void;
}

const NO_TREES: Trees = { meshes: [], count: 0, setCap: () => {}, dispose: () => {} };

/**
 * Instances already-placed trees: `species[i]` (0 or 1) picks which of the biome's two forms
 * `matrices[i]` grows. Shared by `createTrees`, the course woods and `treeline.ts`, so all three
 * build, instance and free trees the same way.
 */
export function plantTrees(
  palette: BiomePalette,
  matrices: readonly THREE.Matrix4[],
  species: readonly number[],
  tints?: readonly number[],
  /**
   * Which trees are far (`FAR_TREE_OUTSIDE_M`), drawn with the low-poly species in meshes of their
   * own. A split made once here: switching by distance per frame would rewrite instance buffers.
   */
  far?: readonly boolean[],
): Trees {
  if (matrices.length === 0) return NO_TREES;

  const anyFar = far !== undefined && far.some((f) => f);
  const geometries = [...buildTreeGeometries(palette), ...(anyFar ? buildTreeGeometries(palette, true) : [])];
  const material = treeMaterial();
  const colour = new THREE.Color();
  const meshes: THREE.InstancedMesh[] = [];
  // Near species 0 and 1, then far species 0 and 1.
  for (let g = 0; g < geometries.length; g++) {
    const s = g & 1;
    const wantFar = g >= 2;
    const belongs = (i: number): boolean => species[i] === s && (far?.[i] === true) === wantFar;
    let count = 0;
    for (let i = 0; i < species.length; i++) if (belongs(i)) count++;
    if (count === 0) continue;
    const mesh = new THREE.InstancedMesh(geometries[g]!, material, count);
    if (wantFar) mesh.name = "far-trees";
    let slot = 0;
    for (let i = 0; i < matrices.length; i++) {
      if (!belongs(i)) continue;
      if (tints) mesh.setColorAt(slot, tintColour(tints[i]!, colour));
      mesh.setMatrixAt(slot++, matrices[i]!);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    // The trees never move, so three can skip re-uploading the matrix buffer every frame.
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    // Frustum culling on an InstancedMesh tests one bounding volume for the whole wood; three
    // computes it from the instance matrices, so it has to be asked for after they are set.
    mesh.computeBoundingSphere();
    meshes.push(mesh);
  }

  const capacity = meshes.map((mesh) => mesh.count);
  return {
    meshes,
    count: matrices.length,
    setCap: (cap) => {
      const share = Math.min(1, Math.max(0, cap) / matrices.length);
      meshes.forEach((mesh, i) => (mesh.count = Math.round(capacity[i]! * share)));
    },
    dispose: () => {
      // Both geometries, including a species that planted nothing and so has no mesh.
      for (const geometry of geometries) geometry.dispose();
      material.dispose();
      for (const mesh of meshes) mesh.dispose();
    },
  };
}


/**
 * Placement is deterministic in the hole's seed (channel 3, alongside height at 0, sand at 1 and
 * the layout draw at 2), so the same hole grows the same wood on every machine and every run.
 * That is what keeps a scene-gate screenshot meaningful and what would let a future server and
 * client agree on cover without replicating a tree list.
 */
export function createTrees(terrain: Terrain, surfaces: Surfaces): Trees {
  const spec = terrain.spec;
  const palette = BIOMES[spec.biome];
  const random = mulberry32(hashChannel(spec.seed, spec.index, 3));
  const speciesRandom = mulberry32(hashChannel(spec.seed, spec.index, SPECIES_CHANNEL));
  const weights = createSurfaceWeights();

  const half = spec.fieldSize / 2;
  const cells = Math.floor(spec.fieldSize / CELL_M);
  // treeDensity is per 1000 m^2; a cell is CELL_M^2, so this is the chance a given cell is
  // occupied at all. Above 1 the cap simply saturates -- density is a dial, not a promise.
  const perCell = (palette.treeDensity * CELL_M * CELL_M) / 1000;

  const matrices: THREE.Matrix4[] = [];
  const species: number[] = [];
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  for (let row = 0; row < cells && matrices.length < MAX_TREES; row++) {
    for (let col = 0; col < cells && matrices.length < MAX_TREES; col++) {
      if (random() > perCell) continue;

      const x = -half + (col + random()) * CELL_M;
      const z = -half + (row + random()) * CELL_M;

      surfaces.weightsAt(x, z, weights);
      if (weights.corridor < MIN_ROUGH_WEIGHT) continue;
      if (weights.sand === 1 || weights.water === 1) continue;

      const y = terrain.heightAt(x, z);
      // Freeboard is measured against the hazard, not against an absolute height. Before Tier 2
      // `waterLevel` *was* the definition of water, so "below the water line" and "in the water"
      // were the same statement; now water is a placed polygon (`weights.water` above already
      // rejects it) and low dry ground is just a hollow. Keeping the absolute test would strip
      // trees off every dip on a hole with no water in it at all.
      //
      // What survives is the shoreline case: the basin ramps down over WATER_SHORE, so ground
      // that has been pulled below the rendered water plane is inside a hazard's shallows even
      // where the polygon test has not caught it yet.
      if (spec.water.length > 0 && y < spec.waterLevel + MIN_FREEBOARD) continue;

      const height = palette.treeHeight * (SCALE_MIN + random() * (SCALE_MAX - SCALE_MIN));
      position.set(x, y, z);
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), random() * Math.PI * 2);
      scale.set(height, height, height);
      matrices.push(matrix.clone().compose(position, quaternion, scale));
      species.push(speciesRandom() < 0.5 ? 0 : 1);
    }
  }

  return plantTrees(palette, matrices, species);
}

export interface CourseWoodsOptions {
  /** The course seed; placement is deterministic in it. */
  readonly seed: number;
  /** Trees stay on the playing side of the road; the treeline owns the far side. */
  readonly southBoundary?: SouthBoundary | undefined;
  readonly clubhouse?: Vec2 | undefined;
  /** The arena zone's edge; trees `FAR_TREE_OUTSIDE_M` beyond it get the low-poly species. */
  readonly zone?: readonly Vec2[] | undefined;
}

/** Metres outside a closed polygon: 0 inside it, the distance to its nearest edge outside. */
export function outsideBy(polygon: readonly Vec2[], x: number, z: number): number {
  let inside = false;
  let nearest = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const t = Math.min(1, Math.max(0, ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez || 1)));
    nearest = Math.min(nearest, Math.hypot(x - a.x - ex * t, z - a.z - ez * t));
  }
  return inside ? 0 : nearest;
}

/**
 * Per-instance colour, multiplied into the baked vertex colours: a little lighter or darker and a
 * touch warmer or cooler, so a wood of one species is not one swatch.
 */
function tintColour(t: number, out: THREE.Color): THREE.Color {
  const light = 0.86 + 0.24 * t;
  const warm = (t - 0.5) * 0.08;
  return out.setRGB(light * (1 + warm), light, light * (1 - warm * 1.5));
}

/**
 * The woods of an eighteen-hole course, in the match: clumps and stands placed by
 * `woodsPlacement.ts`, each biome's two species as two InstancedMeshes (up to six draws).
 * Decorative: no collider, never read by the sim.
 */
export function createCourseTrees(
  course: CourseTerrain,
  surfaces: Surfaces,
  options: CourseWoodsOptions,
  /** The placement, when the caller already has it (`courseDressing.ts` also builds the woods floor from it). */
  placement?: readonly PlacedTree[],
): Trees {
  const placed = clumpOrder(placement ?? placeCourseWoods(course, surfaces, options), options.seed);

  const byBiome = new Map<BiomeId, { matrices: THREE.Matrix4[]; species: number[]; tints: number[]; far: boolean[] }>();
  const zone = options.zone;
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (const tree of placed) {
    let wood = byBiome.get(tree.biome);
    if (wood === undefined) {
      wood = { matrices: [], species: [], tints: [], far: [] };
      byBiome.set(tree.biome, wood);
    }
    position.set(tree.x, tree.y, tree.z);
    quaternion.setFromAxisAngle(up, tree.turn);
    scale.set(tree.height, tree.height, tree.height);
    wood.matrices.push(new THREE.Matrix4().compose(position, quaternion, scale));
    wood.species.push(tree.species);
    wood.tints.push(tree.tint);
    wood.far.push(zone !== undefined && zone.length >= 3 && outsideBy(zone, tree.x, tree.z) > FAR_TREE_OUTSIDE_M);
  }

  const woods = [...byBiome.entries()].map(([biome, wood]) =>
    plantTrees(BIOMES[biome], wood.matrices, wood.species, wood.tints, wood.far),
  );
  const count = woods.reduce((sum, wood) => sum + wood.count, 0);
  return {
    meshes: woods.flatMap((wood) => wood.meshes),
    count,
    setCap: (cap) => {
      // The same share of every biome's wood, so the cap thins the course evenly.
      const share = Math.min(1, Math.max(0, cap) / Math.max(count, 1));
      for (const wood of woods) wood.setCap(Math.round(wood.count * share));
    },
    dispose: () => {
      for (const wood of woods) wood.dispose();
    },
  };
}
