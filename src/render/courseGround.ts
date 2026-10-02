import * as THREE from "three";
import { biomeForIndex } from "../sim/course";
import type { BiomeId } from "../sim/course";
import type { CourseTerrain } from "../sim/courseTerrain";
import { createSurfaceWeights } from "../sim/surfaces";
import type { Surfaces } from "../sim/surfaces";
import { BIOMES } from "./biomes";
import { applyGroundShader } from "./groundShader";

/**
 * The whole course, drawn as tiles that get finer as you approach them.
 *
 * One hole ships one 220 m mesh and one 0.5 m surface mask; the course is 1056 x 1613 m, and the
 * same recipe would be 2 million mask texels and 6 million triangles. Both numbers are affordable
 * to *hold* and neither is affordable to *build*: `CourseSurfaces.weightsAt` costs 3.0 us a call
 * (measured -- it is the spline nearest-point scan, and there are eighteen splines), so a 0.5 m
 * mask over one 180 m tile is 395 ms of work and a course-wide one is over ten minutes. That
 * number is what shapes this module.
 *
 * So the ground is a grid of tiles, each built twice over:
 *
 * - **Far**, at construction: `FAR_CELL_M` geometry and a `FAR_MASK_M` mask, about 8 ms a tile.
 *   Every tile has one from the start, so the course is complete and drivable immediately.
 * - **Near**, on approach: `NEAR_CELL_M` geometry and a `NEAR_MASK_M` mask -- the same 2 m the
 *   physics heightfield uses, so what you see resolves exactly what you can drive on. About 65 ms
 *   a tile, which is why it is built a few rows per frame against a millisecond budget rather
 *   than in one hitch.
 *
 * **Tiles carry skirts.** A near tile beside a far one has vertices the far one does not, so the
 * two edges do not meet exactly and the gap shows as a crack straight through to the sky. Each
 * tile drops a `SKIRT_M` apron around its rim, so a crack shows ground behind it instead.
 *
 * **One program, many materials.** The mask rides in as each material's own `map`, which three
 * binds per material, so every tile shares one compiled shader. A per-tile uniform would mean a
 * per-tile program -- dozens of compiles at load, for one texture's difference.
 */

/** Metres per tile, before the course is divided into a whole number of them. */
const TILE_TARGET_M = 180;

/** Geometry cell size, near and far. Near matches the physics heightfield's own cell. */
const NEAR_CELL_M = 2;
const FAR_CELL_M = 8;

/** Mask texel size, near and far. */
const NEAR_MASK_M = 2;
const FAR_MASK_M = 8;

/** A tile closer than this to the camera is worth its near build. */
const NEAR_RADIUS_M = 320;

/**
 * How far past `NEAR_RADIUS_M` a tile already drawn near stays near. Without it a camera on the
 * line swaps a tile's two levels every frame it wobbles across.
 */
const NEAR_HYSTERESIS_M = 60;

/**
 * Most near tiles held at once. About what the radius wants around one point (a disc of 320 m
 * over 180 m tiles is 16 to 21 of them), so a lap of the course evicts, least recently wanted
 * first, rather than keeping every tile it ever drove past. A tile past the cap that the camera
 * wants stays coarse until one is free: the build order is nearest first, so that is the farthest.
 */
const NEAR_TILE_CAP = 20;

/** How long `update` may spend building, per call. Under a sixth of a 16.67 ms frame. */
const BUILD_BUDGET_MS = 2.5;

/** How far a tile's apron hangs below its rim. Deeper than any crack an LOD seam can open. */
const SKIRT_M = 2.5;

/** Biome order in the shader's palette arrays and in the `aBiome` attribute. */
const BIOME_ORDER: readonly BiomeId[] = ["parkland", "links", "marsh"];

export interface CourseGround {
  readonly group: THREE.Group;
  /**
   * Promote tiles near the camera, demote the ones it has left, and spend at most
   * `BUILD_BUDGET_MS` on whatever building that implies. Call once per rendered frame.
   */
  update(cameraX: number, cameraZ: number): void;
  /**
   * Called on every tile material built from now on: High's shadow cascades patch it
   * (`render/shadows.ts`). Set by the match scene that borrows the ground, cleared when it goes.
   */
  decorateMaterial: ((material: THREE.MeshStandardMaterial) => void) | null;
  /** Tiles currently drawn at near detail. For tests and the smoke check. */
  readonly nearTileCount: number;
  /** Tiles holding a near level, drawn or not. Never more than `NEAR_TILE_CAP`. */
  readonly residentNearTiles: number;
  /** Near levels built since construction, evicted ones included. */
  readonly nearBuilds: number;
  /** True while the last `update` left a tile it wants near unbuilt, with room to build it. */
  readonly building: boolean;
  /** The tile under a point and the level it is drawn at, or null off the course. Allocates: for
   *  tests and the smoke check, not for a frame. */
  tileAt(
    x: number,
    z: number,
  ): { minX: number; minZ: number; sizeX: number; sizeZ: number; level: "near" | "far"; resident: boolean } | null;
  dispose(): void;
}

interface TileLevel {
  readonly mesh: THREE.Mesh;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.MeshStandardMaterial;
  readonly mask: THREE.DataTexture;
}

interface Tile {
  readonly minX: number;
  readonly minZ: number;
  readonly sizeX: number;
  readonly sizeZ: number;
  far: TileLevel;
  near: TileLevel | null;
  /** Work in progress toward `near`, if any. */
  job: NearJob | null;
  /** The last `update` that wanted this tile near, for least-recently-wanted eviction. */
  wantedAt: number;
}

/** A near build, part-done. Rows are filled a few at a time so no frame pays for a whole tile. */
interface NearJob {
  readonly maskSize: number;
  readonly maskData: Uint8Array;
  maskRow: number;
  readonly cells: number;
  readonly positions: Float32Array;
  readonly biome: Uint8Array;
  readonly mow: Int8Array;
  gridRow: number;
}

function paletteVector(field: "green" | "fairway" | "rough" | "sand" | "water"): THREE.Color[] {
  return BIOME_ORDER.map((biome) => new THREE.Color(BIOMES[biome][field]));
}

export function createCourseGround(terrain: CourseTerrain, surfaces: Surfaces): CourseGround {
  let decorate: ((material: THREE.MeshStandardMaterial) => void) | null = null;
  const group = new THREE.Group();
  const extentX = terrain.bounds.maxX - terrain.bounds.minX;
  const extentZ = terrain.bounds.maxZ - terrain.bounds.minZ;
  const tilesX = Math.max(1, Math.round(extentX / TILE_TARGET_M));
  const tilesZ = Math.max(1, Math.round(extentZ / TILE_TARGET_M));
  const sizeX = extentX / tilesX;
  const sizeZ = extentZ / tilesZ;

  // Shared by every tile: the palettes are the same everywhere, and only the mask differs.
  const uniforms = {
    uGreenBiome: { value: paletteVector("green") },
    uFairwayBiome: { value: paletteVector("fairway") },
    uRoughBiome: { value: paletteVector("rough") },
    uSandBiome: { value: paletteVector("sand") },
    uWaterBiome: { value: paletteVector("water") },
  };

  const weightScratch = new Float32Array(terrain.holes.length);
  const biomeScratch = new Float32Array(BIOME_ORDER.length);
  /** Each hole's biome as an index into `BIOME_ORDER`, looked up once rather than per vertex. */
  const holeBiome = terrain.holes.map((hole) => BIOME_ORDER.indexOf(biomeForIndex(hole.spec.index)));
  const surfaceWeights = createSurfaceWeights();

  /**
   * Height, biome weights and mow direction for one vertex, off one `weightsInto`: all three are a
   * question about which holes own the point, and asking three times was most of a tile's cost.
   *
   * Biome weights go in `BIOME_ORDER`, as bytes (0..255 is 0..1). The mow direction is the owning
   * hole's `stripeAngle` turned by its placement, as signed bytes (-127..127 is -1..1), and zero
   * where no hole owns the ground, which is where the stripes are faded out anyway.
   */
  function vertexInto(
    x: number,
    z: number,
    positions: Float32Array,
    biome: Uint8Array,
    mow: Int8Array,
    index: number,
  ): void {
    const owner = terrain.weightsInto(x, z, weightScratch);
    positions[index * 3] = x;
    positions[index * 3 + 1] = terrain.heightFromWeights(x, z, weightScratch);
    positions[index * 3 + 2] = z;

    biomeScratch[0] = 0;
    biomeScratch[1] = 0;
    biomeScratch[2] = 0;
    for (let i = 0; i < weightScratch.length; i++) {
      const weight = weightScratch[i]!;
      if (weight <= 0) continue;
      biomeScratch[holeBiome[i]!]! += weight;
    }
    biome[index * 3] = Math.round(biomeScratch[0]! * 255);
    biome[index * 3 + 1] = Math.round(biomeScratch[1]! * 255);
    biome[index * 3 + 2] = Math.round(biomeScratch[2]! * 255);

    if (owner < 0) {
      mow[index * 2] = 0;
      mow[index * 2 + 1] = 0;
      return;
    }
    const hole = terrain.holes[owner]!;
    const angle = hole.spec.stripeAngle + hole.placement.rotation;
    mow[index * 2] = Math.round(Math.cos(angle) * 127);
    mow[index * 2 + 1] = Math.round(Math.sin(angle) * 127);
  }

  /** One row of mask texels. Split out because a near tile fills these a few rows at a time. */
  function fillMaskRow(
    tile: Tile,
    data: Uint8Array,
    size: number,
    row: number,
  ): void {
    // Texel centres, not corners: sampling the corner biases every surface half a texel
    // north-west of where it actually is.
    const worldZ = tile.minZ + ((row + 0.5) / size) * tile.sizeZ;
    for (let col = 0; col < size; col++) {
      const worldX = tile.minX + ((col + 0.5) / size) * tile.sizeX;
      surfaces.weightsAt(worldX, worldZ, surfaceWeights);
      const i = (row * size + col) * 4;
      data[i] = Math.round(surfaceWeights.green * 255);
      data[i + 1] = Math.round(surfaceWeights.corridor * 255);
      data[i + 2] = surfaceWeights.sand * 255;
      data[i + 3] = surfaceWeights.water * 255;
    }
  }

  /** One row of grid vertices: height, biome weights and mow direction. */
  function fillGridRow(
    tile: Tile,
    cells: number,
    row: number,
    positions: Float32Array,
    biome: Uint8Array,
    mow: Int8Array,
  ): void {
    const worldZ = tile.minZ + (row / cells) * tile.sizeZ;
    for (let col = 0; col <= cells; col++) {
      const worldX = tile.minX + (col / cells) * tile.sizeX;
      vertexInto(worldX, worldZ, positions, biome, mow, row * (cells + 1) + col);
    }
  }

  /**
   * Grid plus skirt, as one indexed geometry.
   *
   * The grid is built in world coordinates and the mesh sits at the origin: a tile is a window
   * onto one ground rather than an object with a place of its own, and keeping the coordinates
   * world-space means the shader's world position needs no transform to match.
   */
  function buildGeometry(
    cells: number,
    positions: Float32Array,
    biome: Uint8Array,
    mow: Int8Array,
  ): THREE.BufferGeometry {
    const side = cells + 1;
    const gridVerts = side * side;
    // The skirt is its own geometry: four edges, each carrying a copy of the rim and a row
    // SKIRT_M below it.
    const skirtVerts = side * 8;
    const total = gridVerts + skirtVerts;

    const pos = new Float32Array(total * 3);
    const bio = new Uint8Array(total * 3);
    const mowAttr = new Int8Array(total * 2);
    const uv = new Float32Array(total * 2);
    pos.set(positions);
    bio.set(biome);
    mowAttr.set(mow);

    for (let row = 0; row < side; row++) {
      for (let col = 0; col < side; col++) {
        const index = row * side + col;
        uv[index * 2] = col / cells;
        uv[index * 2 + 1] = row / cells;
      }
    }

    const indices: number[] = [];
    for (let row = 0; row < cells; row++) {
      for (let col = 0; col < cells; col++) {
        const a = row * side + col;
        const b = a + 1;
        const c = a + side;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    // The skirt gets its own copy of the rim as well as the dropped row, so its triangles
    // contribute nothing to the rim's normals. Sharing the rim vertices instead tilts every
    // normal along the seam toward the wall, and the tile edges read as dark lines across the
    // course -- which is exactly what the first build of this looked like.
    const edges: readonly { rim(i: number): number }[] = [
      { rim: (i) => i }, // row 0
      { rim: (i) => (side - 1) * side + i }, // last row
      { rim: (i) => i * side }, // col 0
      { rim: (i) => i * side + (side - 1) }, // last col
    ];
    // Where each skirt vertex hangs from, so its normal can be copied off the rim below.
    const skirtRim = new Int32Array(skirtVerts);
    let next = gridVerts;
    for (let e = 0; e < edges.length; e++) {
      const edge = edges[e]!;
      const top = next;
      const low = next + side;
      for (let i = 0; i < side; i++) {
        const rim = edge.rim(i);
        for (const [target, drop] of [
          [top + i, 0],
          [low + i, SKIRT_M],
        ] as const) {
          pos[target * 3] = pos[rim * 3]!;
          pos[target * 3 + 1] = pos[rim * 3 + 1]! - drop;
          pos[target * 3 + 2] = pos[rim * 3 + 2]!;
          bio[target * 3] = bio[rim * 3]!;
          bio[target * 3 + 1] = bio[rim * 3 + 1]!;
          bio[target * 3 + 2] = bio[rim * 3 + 2]!;
          mowAttr[target * 2] = mowAttr[rim * 2]!;
          mowAttr[target * 2 + 1] = mowAttr[rim * 2 + 1]!;
          uv[target * 2] = uv[rim * 2]!;
          uv[target * 2 + 1] = uv[rim * 2 + 1]!;
          skirtRim[target - gridVerts] = rim;
        }
      }
      next += side * 2;
      // Wound both ways: which side of a skirt faces the camera depends on which edge of which
      // tile it is, and a one-sided apron is invisible from half of them.
      for (let i = 0; i < side - 1; i++) {
        indices.push(top + i, low + i, top + i + 1, top + i + 1, low + i, low + i + 1);
        indices.push(top + i + 1, low + i, top + i, low + i + 1, low + i, top + i + 1);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute("aBiome", new THREE.BufferAttribute(bio, 3, true));
    geometry.setAttribute("aMow", new THREE.BufferAttribute(mowAttr, 2, true));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    // A skirt is filler, not a wall, so it is shaded as the ground it hangs from rather than as
    // the vertical surface it geometrically is. Its own normals are useless anyway: the quads are
    // wound both ways, so the two contributions cancel and `computeVertexNormals` leaves a zero
    // normal, which shades black -- the tile edges read as a dark grid across the whole course.
    const normals = geometry.getAttribute("normal") as THREE.BufferAttribute;
    const normalArray = normals.array as Float32Array;
    for (let i = 0; i < skirtVerts; i++) {
      const target = gridVerts + i;
      const rim = skirtRim[i]!;
      normalArray[target * 3] = normalArray[rim * 3]!;
      normalArray[target * 3 + 1] = normalArray[rim * 3 + 1]!;
      normalArray[target * 3 + 2] = normalArray[rim * 3 + 2]!;
    }
    normals.needsUpdate = true;

    // Bounds now, while the positions are certainly here: three computes them lazily for frustum
    // culling, and a tile is never re-shaped after this.
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    // The GPU owns these once uploaded, and nothing on the CPU reads them again. Positions and the
    // index are kept: the bounds and the smoke's NaN check read them.
    for (const name of ["aBiome", "aMow", "uv", "normal"]) {
      (geometry.getAttribute(name) as THREE.BufferAttribute).onUpload(releaseArray);
    }
    return geometry;
  }

  function buildMaterial(mask: THREE.DataTexture): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0.0 });
    material.map = mask;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      applyGroundShader(shader, { course: true });
    };
    // One key for every tile: they differ only in the map, which three binds per material, so
    // they share a compiled program rather than one each.
    material.customProgramCacheKey = () => "course-ground";
    return material;
  }

  function makeMask(data: Uint8Array, size: number): THREE.DataTexture {
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    // The mask is weights and flags, not colour: sRGB-decoding it would bend the falloff curve.
    texture.colorSpace = THREE.NoColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  function buildLevel(
    cells: number,
    maskSize: number,
    positions: Float32Array,
    biome: Uint8Array,
    mow: Int8Array,
    maskData: Uint8Array,
  ): TileLevel {
    const mask = makeMask(maskData, maskSize);
    const material = buildMaterial(mask);
    decorate?.(material);
    const geometry = buildGeometry(cells, positions, biome, mow);
    const mesh = new THREE.Mesh(geometry, material);
    // Harmless with shadows off: no shadow map, nothing to receive.
    mesh.receiveShadow = true;
    return { mesh, geometry, material, mask };
  }

  function disposeLevel(level: TileLevel): void {
    level.geometry.dispose();
    level.material.dispose();
    level.mask.dispose();
  }

  const tiles: Tile[] = [];
  for (let tz = 0; tz < tilesZ; tz++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const tile: Tile = {
        minX: terrain.bounds.minX + tx * sizeX,
        minZ: terrain.bounds.minZ + tz * sizeZ,
        sizeX,
        sizeZ,
        far: null as unknown as TileLevel,
        near: null,
        job: null,
        wantedAt: -1,
      };
      const cells = Math.max(1, Math.round(Math.max(sizeX, sizeZ) / FAR_CELL_M));
      const maskSize = Math.max(2, Math.round(Math.max(sizeX, sizeZ) / FAR_MASK_M));
      const side = cells + 1;
      const positions = new Float32Array(side * side * 3);
      const biome = new Uint8Array(side * side * 3);
      const mow = new Int8Array(side * side * 2);
      for (let row = 0; row < side; row++) fillGridRow(tile, cells, row, positions, biome, mow);
      const maskData = new Uint8Array(maskSize * maskSize * 4);
      for (let row = 0; row < maskSize; row++) fillMaskRow(tile, maskData, maskSize, row);
      tile.far = buildLevel(cells, maskSize, positions, biome, mow, maskData);
      group.add(tile.far.mesh);
      tiles.push(tile);
    }
  }

  function distanceToTile(tile: Tile, x: number, z: number): number {
    const dx = Math.max(tile.minX - x, 0, x - (tile.minX + tile.sizeX));
    const dz = Math.max(tile.minZ - z, 0, z - (tile.minZ + tile.sizeZ));
    return Math.hypot(dx, dz);
  }

  function startJob(tile: Tile): void {
    const cells = Math.max(1, Math.round(Math.max(tile.sizeX, tile.sizeZ) / NEAR_CELL_M));
    const maskSize = Math.max(2, Math.round(Math.max(tile.sizeX, tile.sizeZ) / NEAR_MASK_M));
    const side = cells + 1;
    tile.job = {
      maskSize,
      maskData: new Uint8Array(maskSize * maskSize * 4),
      maskRow: 0,
      cells,
      positions: new Float32Array(side * side * 3),
      biome: new Uint8Array(side * side * 3),
      mow: new Int8Array(side * side * 2),
      gridRow: 0,
    };
  }

  let frame = 0;
  let resident = 0;
  let builds = 0;
  let jobs = 0;
  /** See `CourseGround.building`. */
  let pending = false;

  /** Returns true when the job finished on this call. */
  function advanceJob(tile: Tile, deadline: number): boolean {
    const job = tile.job!;
    while (performance.now() < deadline) {
      if (job.maskRow < job.maskSize) {
        fillMaskRow(tile, job.maskData, job.maskSize, job.maskRow);
        job.maskRow++;
        continue;
      }
      if (job.gridRow <= job.cells) {
        fillGridRow(tile, job.cells, job.gridRow, job.positions, job.biome, job.mow);
        job.gridRow++;
        continue;
      }
      tile.near = buildLevel(
        job.cells,
        job.maskSize,
        job.positions,
        job.biome,
        job.mow,
        job.maskData,
      );
      group.add(tile.near.mesh);
      tile.job = null;
      jobs--;
      resident++;
      builds++;
      return true;
    }
    return false;
  }

  /** Frees the near level wanted longest ago among those not drawn. False if every one is drawn. */
  function evictOne(): boolean {
    let oldest: Tile | null = null;
    for (const tile of tiles) {
      if (tile.near === null || tile.near.mesh.visible) continue;
      if (oldest === null || tile.wantedAt < oldest.wantedAt) oldest = tile;
    }
    if (oldest === null) return false;
    group.remove(oldest.near!.mesh);
    disposeLevel(oldest.near!);
    oldest.near = null;
    oldest.far.mesh.visible = true;
    resident--;
    return true;
  }

  function update(cameraX: number, cameraZ: number): void {
    frame++;
    const deadline = performance.now() + BUILD_BUDGET_MS;
    let closest: Tile | null = null;
    let closestDistance = Infinity;
    let unbuilt = 0;

    for (const tile of tiles) {
      const distance = distanceToTile(tile, cameraX, cameraZ);
      if (tile.near !== null) {
        const showNear =
          distance <= NEAR_RADIUS_M ||
          (tile.near.mesh.visible && distance <= NEAR_RADIUS_M + NEAR_HYSTERESIS_M);
        tile.near.mesh.visible = showNear;
        tile.far.mesh.visible = !showNear;
        if (showNear) tile.wantedAt = frame;
        continue;
      }
      if (distance > NEAR_RADIUS_M) {
        // A part-built tile the camera has left is abandoned rather than finished: it may never be
        // wanted again, and its arrays are most of a megabyte.
        if (tile.job !== null) {
          tile.job = null;
          jobs--;
        }
        continue;
      }
      tile.wantedAt = frame;
      unbuilt++;
      if (distance < closestDistance) {
        closestDistance = distance;
        closest = tile;
      }
    }

    pending = false;
    if (closest === null) return;
    // Room first: a build is only started, and only finished, with a slot to put it in.
    if (resident >= NEAR_TILE_CAP && !evictOne()) return;
    pending = true;
    if (closest.job === null) {
      startJob(closest);
      jobs++;
    }
    // Nearest first, and one tile at a time: the ground under the camera is worth finishing
    // before the ground two tiles away is started.
    if (advanceJob(closest, deadline)) {
      closest.near!.mesh.visible = true;
      closest.far.mesh.visible = false;
      pending = unbuilt > 1;
    }
  }

  function tileAt(x: number, z: number): ReturnType<CourseGround["tileAt"]> {
    for (const tile of tiles) {
      if (x < tile.minX || x > tile.minX + tile.sizeX || z < tile.minZ || z > tile.minZ + tile.sizeZ) continue;
      const level = tile.near !== null && tile.near.mesh.visible ? "near" : "far";
      return { minX: tile.minX, minZ: tile.minZ, sizeX: tile.sizeX, sizeZ: tile.sizeZ, level, resident: tile.near !== null };
    }
    return null;
  }

  return {
    group,
    update,
    tileAt,
    get decorateMaterial() {
      return decorate;
    },
    set decorateMaterial(fn) {
      decorate = fn;
    },
    get nearTileCount(): number {
      let count = 0;
      for (const tile of tiles) if (tile.near !== null && tile.near.mesh.visible) count++;
      return count;
    },
    get residentNearTiles(): number {
      return resident;
    },
    get nearBuilds(): number {
      return builds;
    },
    get building(): boolean {
      return pending;
    },
    dispose: () => {
      for (const tile of tiles) {
        disposeLevel(tile.far);
        if (tile.near !== null) disposeLevel(tile.near);
      }
      group.clear();
    },
  };
}

/**
 * Let an attribute's CPU copy go once three has uploaded it. A function rather than an arrow: three
 * calls it with the attribute as `this`.
 */
function releaseArray(this: THREE.BufferAttribute): void {
  this.array = EMPTY_ARRAYS.get(this.array.constructor) ?? this.array.slice(0, 0);
}

/** One empty array per type, so letting go of a thousand attributes allocates nothing. */
const EMPTY_ARRAYS = new Map<unknown, THREE.TypedArray>([
  [Float32Array, new Float32Array(0)],
  [Uint8Array, new Uint8Array(0)],
  [Int8Array, new Int8Array(0)],
]);

/** Exported for the tests and the gate: one tile of ground, built the way the course builds it. */
export const COURSE_GROUND_TUNING = {
  TILE_TARGET_M,
  NEAR_CELL_M,
  FAR_CELL_M,
  NEAR_MASK_M,
  FAR_MASK_M,
  NEAR_RADIUS_M,
  NEAR_HYSTERESIS_M,
  NEAR_TILE_CAP,
  SKIRT_M,
} as const;
