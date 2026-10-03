import * as THREE from "three";
import { mergeGraph } from "../entities/primitiveGraph";
import { TREE_SPECIES, treeGraph } from "../entities/envGraphs";
import { biomeForIndex } from "../sim/course";
import { metresNorthOf } from "../sim/courseBarrier";
import type { SouthBoundary } from "../sim/courseBarrier";
import type { CourseTerrain } from "../sim/courseTerrain";
import type { Vec2 } from "../sim/mapGeometry";
import { hashChannel, mulberry32 } from "../sim/rng";
import { createSurfaceWeights } from "../sim/surfaces";
import type { Surfaces } from "../sim/surfaces";
import { WOODS_WEIGHT } from "../sim/terrain";
import type { Terrain } from "../sim/terrain";
import { BIOMES } from "./biomes";
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

/** The course woods' own channel, beside the treeline's 6. */
const COURSE_WOODS_CHANNEL = 9;

/**
 * The biome's two species, each merged into one geometry with the biome's colours baked in.
 *
 * Exported so `treeline.ts` grows the same trees rather than a second pair that drifts from them.
 * The horizon band beyond the road is the same species as the wood inside it, or the edge of the
 * course reads as a change of continent. Each species is authored at unit height, so the caller's
 * `palette.treeHeight` scale is the tree's height in metres.
 */
export function buildTreeGeometries(palette: BiomePalette): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const overrides = {
    tree_trunk: palette.trunk,
    tree_foliage_dark: palette.foliageDark,
    tree_foliage_light: palette.foliageLight,
  };
  const geometryOf = (name: (typeof TREE_SPECIES)[typeof palette.treeForm][number]): THREE.BufferGeometry => {
    // No contact shade: a species is authored at unit height and scaled to metres later, so graph
    // space is not metres above the ground and the shade would darken most of the tree.
    const merged = mergeGraph(treeGraph(name), overrides, { contactShade: false });
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
  dispose(): void;
}

const NO_TREES: Trees = { meshes: [], count: 0, dispose: () => {} };

/**
 * Instances already-placed trees: `species[i]` (0 or 1) picks which of the biome's two forms
 * `matrices[i]` grows. Shared by `createTrees`, the course woods and `treeline.ts`, so all three
 * build, instance and free trees the same way.
 */
export function plantTrees(
  palette: BiomePalette,
  matrices: readonly THREE.Matrix4[],
  species: readonly number[],
): Trees {
  if (matrices.length === 0) return NO_TREES;

  const geometries = buildTreeGeometries(palette);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  const meshes: THREE.InstancedMesh[] = [];
  for (let s = 0; s < 2; s++) {
    let count = 0;
    for (let i = 0; i < species.length; i++) if (species[i] === s) count++;
    if (count === 0) continue;
    const mesh = new THREE.InstancedMesh(geometries[s]!, material, count);
    let slot = 0;
    for (let i = 0; i < matrices.length; i++) if (species[i] === s) mesh.setMatrixAt(slot++, matrices[i]!);
    mesh.instanceMatrix.needsUpdate = true;
    // The trees never move, so three can skip re-uploading the matrix buffer every frame.
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    // Frustum culling on an InstancedMesh tests one bounding volume for the whole wood; three
    // computes it from the instance matrices, so it has to be asked for after they are set.
    mesh.computeBoundingSphere();
    meshes.push(mesh);
  }

  return {
    meshes,
    count: matrices.length,
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

/** How far from the clubhouse centre the course woods stay clear: the complex, its barns and spawn
 *  pads, the lot behind it and the welcome sign in front all sit inside this. */
const CLUBHOUSE_CLEAR_M = 55;

export interface CourseWoodsOptions {
  /** The course seed; placement is deterministic in it. */
  readonly seed: number;
  /** Trees stay on the playing side of the road; the treeline owns the far side. */
  readonly southBoundary?: SouthBoundary | undefined;
  readonly clubhouse?: Vec2 | undefined;
}

/**
 * The woods of an eighteen-hole course, in the match. The same planting rule as `createTrees` --
 * the same cell, density, deep-rough threshold and scale spread -- asked of the course's blended
 * ground rather than of one hole's.
 *
 * **Only where a hole reaches.** Each cell takes the biome of the hole with the largest share of
 * it (`CourseTerrain.weightsInto`), and ground no hole reaches has no biome, so it is left open.
 * Water on the course is painted by surface weight, not drawn as a plane at a height, so the
 * shoreline test is any water weight at all rather than `createTrees`' freeboard height.
 *
 * Up to six InstancedMeshes, two per biome present. Decorative: no collider, never read by the sim.
 */
export function createCourseTrees(course: CourseTerrain, surfaces: Surfaces, options: CourseWoodsOptions): Trees {
  const random = mulberry32(hashChannel(options.seed, 0, COURSE_WOODS_CHANNEL));
  const weights = createSurfaceWeights();
  const shares = new Float32Array(course.holes.length);
  const holeBiome = course.holes.map((hole) => biomeForIndex(hole.spec.index));
  const { bounds } = course;

  const byBiome = new Map<BiomeId, { matrices: THREE.Matrix4[]; species: number[] }>();
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const clear2 = CLUBHOUSE_CLEAR_M * CLUBHOUSE_CLEAR_M;

  const cols = Math.floor((bounds.maxX - bounds.minX) / CELL_M);
  const rows = Math.floor((bounds.maxZ - bounds.minZ) / CELL_M);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // A fixed number of draws per cell, whatever it decides, so one cell's rules never move the
      // next cell's tree.
      const occupancy = random();
      const x = bounds.minX + (col + random()) * CELL_M;
      const z = bounds.minZ + (row + random()) * CELL_M;
      const size = random();
      const turn = random();
      const pick = random();

      course.weightsInto(x, z, shares);
      let owner = -1;
      let best = 0;
      for (let i = 0; i < shares.length; i++) {
        if (shares[i]! > best) {
          best = shares[i]!;
          owner = i;
        }
      }
      if (owner < 0) continue;
      const biome = holeBiome[owner]!;
      const palette = BIOMES[biome];
      if (occupancy > (palette.treeDensity * CELL_M * CELL_M) / 1000) continue;

      surfaces.weightsAt(x, z, weights);
      if (weights.corridor < MIN_ROUGH_WEIGHT) continue;
      if (weights.sand === 1 || weights.water > 0) continue;
      if (options.southBoundary && metresNorthOf(options.southBoundary, x, z) <= 0) continue;
      if (options.clubhouse) {
        const dx = x - options.clubhouse.x;
        const dz = z - options.clubhouse.z;
        if (dx * dx + dz * dz < clear2) continue;
      }

      const height = palette.treeHeight * (SCALE_MIN + size * (SCALE_MAX - SCALE_MIN));
      position.set(x, course.heightAt(x, z), z);
      quaternion.setFromAxisAngle(up, turn * Math.PI * 2);
      scale.set(height, height, height);
      let wood = byBiome.get(biome);
      if (wood === undefined) {
        wood = { matrices: [], species: [] };
        byBiome.set(biome, wood);
      }
      wood.matrices.push(matrix.clone().compose(position, quaternion, scale));
      wood.species.push(pick < 0.5 ? 0 : 1);
    }
  }

  const woods = [...byBiome.entries()].map(([biome, wood]) => plantTrees(BIOMES[biome], wood.matrices, wood.species));
  return {
    meshes: woods.flatMap((wood) => wood.meshes),
    count: woods.reduce((sum, wood) => sum + wood.count, 0),
    dispose: () => {
      for (const wood of woods) wood.dispose();
    },
  };
}
