import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { hashChannel, mulberry32 } from "../sim/rng";
import { WOODS_WEIGHT, createSurfaceWeights } from "../sim/surfaces";
import type { Surfaces } from "../sim/surfaces";
import type { Terrain } from "../sim/terrain";
import { BIOMES } from "./biomes";
import type { BiomePalette } from "./biomes";

/**
 * The rough's tree cover, as a single instanced draw.
 *
 * Trees are what make a corridor read as a corridor -- without them a fairway is a colour change
 * on a field, and the concept art's sense of a mown lane cut through woodland comes almost
 * entirely from the treeline. They are also the asset most likely to wreck the frame budget if
 * done naively, which is why AGENTS.md calls out instancing for them specifically.
 *
 * One merged geometry with baked vertex colours, one InstancedMesh, one draw call for every tree
 * on the hole. Trunk and foliage are separate objects in Blender terms but there is no reason for
 * them to be separate draws.
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

/**
 * Builds one tree's geometry, merged and vertex-coloured.
 *
 * The three forms are the biome's whole silhouette vocabulary -- a conifer stack for parkland, a
 * low wide shrub for links, a tall thin reed clump for marsh. They are deliberately crude: this
 * is the flat-shaded low-poly register, and the radial segment counts are low so the facets read.
 */
function buildTreeGeometry(palette: BiomePalette): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const colours: number[][] = [];

  const push = (geometry: THREE.BufferGeometry, y: number, colour: number): void => {
    geometry.translate(0, y, 0);
    parts.push(geometry);
    const rgb = new THREE.Color(colour);
    const count = geometry.attributes.position!.count;
    const flat: number[] = [];
    for (let i = 0; i < count; i++) flat.push(rgb.r, rgb.g, rgb.b);
    colours.push(flat);
  };

  if (palette.treeForm === "conifer") {
    push(new THREE.CylinderGeometry(0.09, 0.13, 0.34, 5), 0.17, palette.trunk);
    push(new THREE.ConeGeometry(0.34, 0.52, 7), 0.5, palette.foliageDark);
    push(new THREE.ConeGeometry(0.26, 0.42, 7), 0.79, palette.foliageLight);
  } else if (palette.treeForm === "shrub") {
    push(new THREE.CylinderGeometry(0.07, 0.1, 0.16, 5), 0.08, palette.trunk);
    // Wider than it is tall: marram-and-gorse scrub, not a tree.
    const bush = new THREE.ConeGeometry(0.55, 0.5, 7);
    push(bush, 0.38, palette.foliageDark);
    push(new THREE.ConeGeometry(0.34, 0.34, 7), 0.68, palette.foliageLight);
  } else {
    push(new THREE.CylinderGeometry(0.05, 0.09, 0.55, 5), 0.27, palette.trunk);
    push(new THREE.ConeGeometry(0.2, 0.62, 6), 0.72, palette.foliageDark);
    push(new THREE.ConeGeometry(0.13, 0.4, 6), 1.05, palette.foliageLight);
  }

  const merged = mergeGeometries(parts, false);
  if (merged === null) throw new Error("tree geometry parts failed to merge");
  for (const part of parts) part.dispose();

  merged.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(colours.flat(), 3),
  );
  return merged;
}

export interface Trees {
  readonly mesh: THREE.InstancedMesh | null;
  readonly count: number;
  dispose(): void;
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
  const weights = createSurfaceWeights();

  const half = spec.fieldSize / 2;
  const cells = Math.floor(spec.fieldSize / CELL_M);
  // treeDensity is per 1000 m^2; a cell is CELL_M^2, so this is the chance a given cell is
  // occupied at all. Above 1 the cap simply saturates -- density is a dial, not a promise.
  const perCell = (palette.treeDensity * CELL_M * CELL_M) / 1000;

  const matrices: THREE.Matrix4[] = [];
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
    }
  }

  if (matrices.length === 0) return { mesh: null, count: 0, dispose: () => {} };

  const geometry = buildTreeGeometry(palette);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
  for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]!);
  mesh.instanceMatrix.needsUpdate = true;
  // The trees never move, so three can skip re-uploading the matrix buffer every frame.
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  // Frustum culling on an InstancedMesh tests one bounding volume for the whole wood; three
  // computes it from the instance matrices, so it has to be asked for after they are set.
  mesh.computeBoundingSphere();

  return {
    mesh,
    count: matrices.length,
    dispose: () => {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}
