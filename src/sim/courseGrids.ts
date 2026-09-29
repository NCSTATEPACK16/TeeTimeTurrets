/**
 * The course ground, baked: height, material and tuning sampled once at every heightfield vertex,
 * and answered from those samples ever after.
 *
 * The blended queries in `courseTerrain.ts` and `courseSurfaces.ts` walk up to eighteen holes and
 * run a spline search per hole per call -- 3 to 6 us each. `Sim` asks them per cart and per ball
 * every tick, the nameplates asked `heightAt` thousands of times a frame, and `Sim.create` asked
 * it 514k times per PLAY to build Rapier's heightfield. The bake pays that once per page.
 *
 * **Why the heightfield's own vertices.** The carts already stand on a 2 m Rapier heightfield of
 * exactly these heights, so between vertices the physics never saw the blended ground. Bilinear
 * lookup over the same samples puts every other height query on the ground the colliders are made
 * of, rather than on a finer surface the carts cannot touch.
 *
 * - Heights and the mown tuning (rolling, bounce, cart speed) are bilinear: continuous things
 *   stay continuous.
 * - The surface class is nearest-vertex. It is a category; there is no half-sand to interpolate.
 * - Where the nearest vertex is sand, water or the bridge, tuning is that vertex's own, not a
 *   blend: those edges are hard on purpose (see `surfaces.ts`), and a cart charged a water stroke
 *   is charged on the same vertex that says the tuning is a hazard.
 *
 * `weightsAt` is the renderer's, never the sim's, and asks the blended surfaces: it draws mown
 * edges at a finer grain than 2 m and is not on any per-tick path.
 *
 * DOM-free, and allocation-free per query.
 */
import type { Bounds } from "./courseLayout";
import type { CourseSurfaces } from "./courseSurfaces";
import type { CourseTerrain } from "./courseTerrain";
import { SURFACE_CODES, SurfaceId, createSurfaceTuning } from "./surfaces";
import type { MutableSurfaceTuning, SurfaceWeights, Surfaces } from "./surfaces";

export interface CourseGrids {
  readonly bounds: Bounds;
  /** Cells along X and Z. Each grid holds `(rows + 1) * (cols + 1)` vertices. */
  readonly cols: number;
  readonly rows: number;
  /**
   * Vertex heights, column-major as Rapier wants them: `heights[row + col * (rows + 1)]`, row
   * along Z and column along X. Handed to the collider as it stands.
   */
  readonly heights: Float32Array;
  /** Vertex surface, as an index into `SURFACE_CODES`. Same layout as `heights`. */
  readonly surface: Uint8Array;
  readonly rolling: Float32Array;
  readonly bounceScale: Float32Array;
  readonly cartSpeedScale: Float32Array;
  /** Bilinear over the vertex heights. */
  heightAt(x: number, z: number): number;
  /** Materials answered from the grids; see the module comment for which query does what. */
  readonly surfaces: Surfaces;
}

const WATER = SURFACE_CODES.indexOf(SurfaceId.Water);
const SAND = SURFACE_CODES.indexOf(SurfaceId.Sand);
const BRIDGE = SURFACE_CODES.indexOf(SurfaceId.Bridge);

/**
 * Samples every vertex once. One `weightsInto` per vertex feeds height, class and tuning, which is
 * why this is a single loop rather than three bakes.
 */
export function bakeCourseGrids(terrain: CourseTerrain, surfaces: CourseSurfaces): CourseGrids {
  const { bounds, cols, rows } = terrain;
  const extentX = bounds.maxX - bounds.minX;
  const extentZ = bounds.maxZ - bounds.minZ;
  const stride = rows + 1;
  const count = stride * (cols + 1);

  const heights = new Float32Array(count);
  const surface = new Uint8Array(count);
  const rolling = new Float32Array(count);
  const bounceScale = new Float32Array(count);
  const cartSpeedScale = new Float32Array(count);

  const weights = new Float32Array(terrain.holes.length);
  const tuning = createSurfaceTuning();
  for (let col = 0; col <= cols; col++) {
    // Computed exactly as `CourseTerrain.buildHeightfield` does, so the collider's heights are the
    // ones it always had.
    const x = bounds.minX + (col / cols) * extentX;
    for (let row = 0; row <= rows; row++) {
      const z = bounds.minZ + (row / rows) * extentZ;
      const i = row + col * stride;
      const owner = terrain.weightsInto(x, z, weights);
      heights[i] = terrain.heightFromWeights(x, z, weights);
      surface[i] = SURFACE_CODES.indexOf(surfaces.surfaceFromOwner(owner, x, z));
      surfaces.tuningFromWeights(owner, weights, x, z, tuning);
      rolling[i] = tuning.rolling;
      bounceScale[i] = tuning.bounceScale;
      cartSpeedScale[i] = tuning.cartSpeedScale;
    }
  }

  // Where the last lookup fell: the cell's low corner and the fractions across it. Closure-owned
  // scratch, since every query below runs inside the fixed tick.
  let c0 = 0;
  let r0 = 0;
  let tx = 0;
  let tz = 0;

  function locate(x: number, z: number): void {
    let fx = ((x - bounds.minX) / extentX) * cols;
    let fz = ((z - bounds.minZ) / extentZ) * rows;
    // Past the edge the ground is the edge: the box is where the world ends, and callers
    // (a ball in flight, a preview arc) do ask just outside it.
    fx = fx < 0 ? 0 : fx > cols ? cols : fx;
    fz = fz < 0 ? 0 : fz > rows ? rows : fz;
    c0 = Math.min(Math.floor(fx), cols - 1);
    r0 = Math.min(Math.floor(fz), rows - 1);
    tx = fx - c0;
    tz = fz - r0;
  }

  function bilinear(grid: Float32Array): number {
    const i00 = r0 + c0 * stride;
    const i10 = i00 + stride;
    const a = grid[i00]! + (grid[i10]! - grid[i00]!) * tx;
    const b = grid[i00 + 1]! + (grid[i10 + 1]! - grid[i00 + 1]!) * tx;
    return a + (b - a) * tz;
  }

  /** The vertex nearest the last located point. */
  function nearest(): number {
    const col = tx < 0.5 ? c0 : c0 + 1;
    const row = tz < 0.5 ? r0 : r0 + 1;
    return row + col * stride;
  }

  function heightAt(x: number, z: number): number {
    locate(x, z);
    return bilinear(heights);
  }

  function surfaceAt(x: number, z: number): SurfaceId {
    locate(x, z);
    return SURFACE_CODES[surface[nearest()]!]!;
  }

  function tuningAt(x: number, z: number, out: MutableSurfaceTuning): void {
    locate(x, z);
    const i = nearest();
    const code = surface[i]!;
    out.isHazard = code === WATER;
    if (code === SAND || code === WATER || code === BRIDGE) {
      out.rolling = rolling[i]!;
      out.bounceScale = bounceScale[i]!;
      out.cartSpeedScale = cartSpeedScale[i]!;
      return;
    }
    out.rolling = bilinear(rolling);
    out.bounceScale = bilinear(bounceScale);
    out.cartSpeedScale = bilinear(cartSpeedScale);
  }

  function weightsAt(x: number, z: number, out: SurfaceWeights): void {
    surfaces.weightsAt(x, z, out);
  }

  return {
    bounds,
    cols,
    rows,
    heights,
    surface,
    rolling,
    bounceScale,
    cartSpeedScale,
    heightAt,
    surfaces: { surfaceAt, tuningAt, weightsAt },
  };
}
