import * as THREE from "three";
import { biomeForIndex } from "../sim/course";
import type { BiomeId } from "../sim/course";
import { hashChannel, mulberry32 } from "../sim/rng";
import { createSurfaceWeights } from "../sim/surfaces";
import type { Surfaces } from "../sim/surfaces";
import { WOODS_WEIGHT } from "../sim/terrain";
import type { CourseTerrain } from "../sim/courseTerrain";
import { BIOMES } from "./biomes";
import { buildTreeGeometry } from "./Trees";

/**
 * The whole course's tree cover, not one hole's.
 *
 * `Trees.ts` (`createTrees`) scatters within a single hole's centred frame and is what the
 * one-hole stroke-play view uses; in the eighteen-hole arena it is switched off, and the drivable
 * world used to have no scattered wood at all -- only the tiled ground and the far treeline beyond
 * the boundary road. The course read as mown lanes on bare grass. This fills the rough across every
 * hole from the same seeded rule, so a bot chase down the ninth runs through the same woodland the
 * player sees standing on the first.
 *
 * It is decorative and render-only, exactly like `createTrees` and `treeline.ts`: no collider, never
 * read by `src/sim/**`, never replicated. Adding tree collision is a separate change that would move
 * the scatter into the sim (see the handoff); this does not.
 *
 * Placement works in world coordinates off the arena data the ground shader already reads --
 * `terrain.weightsInto` for which hole (and so which biome) owns a point, `surfaces.weightsAt` for
 * whether it is rough rather than fairway/sand/water, and `terrain.heightAt` for where to stand the
 * tree. One `InstancedMesh` per biome present (their silhouettes differ), so at most three draws for
 * the entire course, capped so a big open course cannot balloon the buffer.
 */

/** Placement grid pitch, metres. Jittered within the cell, as in `Trees.ts`, so it does not clump. */
const CELL_M = 6;

/** Metres of dry land above the water plane a tree needs before it will be placed. */
const MIN_FREEBOARD = 0.4;


/** Per-instance scale spread, so a stand is not one silhouette copied. Matches `Trees.ts`. */
const SCALE_MIN = 0.75;
const SCALE_MAX = 1.3;

/**
 * RNG channel for the course-wide scatter, distinct from terrain (0), surfaces (1), layout (2),
 * bots (3/4), the reserved pickups channel (5) and the treeline (6). One stream for the whole
 * course keeps the wood identical per seed on every machine.
 */
const COURSE_TREE_CHANNEL = 7;
/** A second stream for thinning to the cap, so the cap never changes where the candidates stand. */
const COURSE_TREE_THIN_CHANNEL = 8;

export interface CourseTrees {
  readonly group: THREE.Group;
  readonly count: number;
  dispose(): void;
}

/**
 * `cap` is the quality preset's tree budget (`QualityPreset.treeCap`). The whole course is scattered
 * first and then thinned to it at random, so a cap takes the same share from every hole. The
 * archived version stopped scanning when it hit its cap, and since it scanned in rows, the southern
 * holes kept their woods and the northern ones got none.
 */
export function createCourseTrees(terrain: CourseTerrain, surfaces: Surfaces, seed: number, cap: number): CourseTrees {
  const random = mulberry32(hashChannel(seed, COURSE_TREE_CHANNEL));
  const weightScratch = new Float32Array(terrain.holes.length);
  const surfaceWeights = createSurfaceWeights();

  const candidates: { biome: BiomeId; matrix: THREE.Matrix4 }[] = [];
  const scratch = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const scale = new THREE.Vector3();

  const cols = Math.floor((terrain.bounds.maxX - terrain.bounds.minX) / CELL_M);
  const rows = Math.floor((terrain.bounds.maxZ - terrain.bounds.minZ) / CELL_M);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cellX = terrain.bounds.minX + col * CELL_M;
      const cellZ = terrain.bounds.minZ + row * CELL_M;

      // Which hole owns this ground decides both whether a tree belongs here at all and what
      // species it is. Off-course cells (no owner) are left to the treeline beyond the road.
      const owner = terrain.weightsInto(cellX + CELL_M / 2, cellZ + CELL_M / 2, weightScratch);
      if (owner < 0) continue;
      const ownerSpec = terrain.holes[owner]!.spec;
      const biome = biomeForIndex(ownerSpec.index);
      const palette = BIOMES[biome];

      // treeDensity is per 1000 m^2; a cell is CELL_M^2, so this is the chance the cell is used.
      const perCell = (palette.treeDensity * CELL_M * CELL_M) / 1000;
      if (random() > perCell) continue;

      const x = cellX + random() * CELL_M;
      const z = cellZ + random() * CELL_M;

      surfaces.weightsAt(x, z, surfaceWeights);
      if (surfaceWeights.corridor < WOODS_WEIGHT) continue; // fairway/green, not rough -- no trees
      if (surfaceWeights.sand === 1 || surfaceWeights.water === 1) continue;

      const y = terrain.heightAt(x, z);
      // Keep trees out of a water hole's shallows. `waterLevel` is a vertical datum, so it reads the
      // same in the hole's own frame and in world space; the placement only moves the field
      // horizontally. Holes with no water skip the test, or every dry hollow would lose its trees.
      if (ownerSpec.water.length > 0 && y < ownerSpec.waterLevel + MIN_FREEBOARD) continue;

      const height = palette.treeHeight * (SCALE_MIN + random() * (SCALE_MAX - SCALE_MIN));
      position.set(x, y, z);
      quaternion.setFromAxisAngle(up, random() * Math.PI * 2);
      scale.set(height, height, height);
      candidates.push({ biome, matrix: scratch.clone().compose(position, quaternion, scale) });
    }
  }

  // Thinned to the cap by a seeded partial shuffle: the first `total` after it are a uniform pick.
  const thin = mulberry32(hashChannel(seed, COURSE_TREE_THIN_CHANNEL));
  const total = Math.min(cap, candidates.length);
  for (let i = 0; i < total; i++) {
    const j = i + Math.floor(thin() * (candidates.length - i));
    const swap = candidates[i]!;
    candidates[i] = candidates[j]!;
    candidates[j] = swap;
  }
  // One matrix list per biome id, since each biome grows a different tree form.
  const perBiome = new Map<BiomeId, THREE.Matrix4[]>();
  for (let i = 0; i < total; i++) {
    const { biome, matrix } = candidates[i]!;
    let list = perBiome.get(biome);
    if (list === undefined) {
      list = [];
      perBiome.set(biome, list);
    }
    list.push(matrix);
  }

  const group = new THREE.Group();
  const disposers: (() => void)[] = [];
  for (const [biome, matrices] of perBiome) {
    if (matrices.length === 0) continue;
    const geometry = buildTreeGeometry(BIOMES[biome]);
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
    for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]!);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.computeBoundingSphere();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    disposers.push(() => {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    });
  }

  return {
    group,
    count: total,
    dispose: () => {
      for (const d of disposers) d();
    },
  };
}

const built = new WeakMap<CourseTerrain, Map<number, CourseTrees>>();

/**
 * The course's trees at `cap`, built once and then shared by every match on it, like the ground
 * (`courseGroundFor`). A scene takes the group out on dispose rather than freeing it.
 */
export function courseTreesFor(terrain: CourseTerrain, surfaces: Surfaces, seed: number, cap: number): CourseTrees {
  let byCap = built.get(terrain);
  if (!byCap) {
    byCap = new Map();
    built.set(terrain, byCap);
  }
  let trees = byCap.get(cap);
  if (!trees) {
    trees = createCourseTrees(terrain, surfaces, seed, cap);
    byCap.set(cap, trees);
  }
  return trees;
}
