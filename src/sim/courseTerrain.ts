/**
 * The eighteen holes as one piece of ground.
 *
 * `courseLayout.ts` answers where each hole is; this answers what the ground does between them.
 * Arena mode is played across the whole course at once, so there is no per-hole field to fall off
 * the edge of and no loading between holes -- one heightfield, `COURSE_CELL_M` cells, no
 * streaming. `tools/terrainProbe.ts` measured that before this module was written:
 * 374k cells, 1.39 ms per tick with 24 carts on it, 82 MB.
 *
 * **The assembly is rough with every hole's own ground laid into it, not a mosaic of fields.**
 * `docs/DECISIONS.md` is explicit that the fields overlap by design -- 47 ha of field into a 36 ha
 * loop -- so "which field is this point in" has no single answer and any rule that picks one
 * produces a cliff where the pick changes. What does have a single answer is how much each hole's
 * *corridor* claims a point, and corridors are laid out never to run into each other
 * (`inspectLayout`). So each hole gets an influence that is 1 over its own ground, falls off over
 * `COURSE_BLEND_M`, and the heights are blended by it. Where two corridors do converge -- the
 * clubhouse apron, which the layout exempts on purpose -- the influences normalise and the two
 * holes average rather than stack.
 *
 * **Inside a corridor the ground is exactly what stroke play would have built**, to the last
 * decimal: influence is 1 there, so `heightAt` hands the query straight to that hole's own
 * `Terrain`. The green is still the green, the bunkers are still dished and the causeway still
 * crosses the pond. Nothing is re-derived here, which is why this module is short.
 *
 * Hazards keep their ground even where the corridor influence has faded, because a pond that is
 * only half-carved is a pond a cart drives into and does not sink in.
 *
 * DOM-free and allocation-free per query: `heightAt` runs inside the fixed tick.
 */
import type { HoleSpec } from "./course";
import { smoothstep01 } from "./curves";
import { boundsOf, toHoleFrame } from "./courseLayout";
import type { Bounds, HolePlacement, PlacedField } from "./courseLayout";
import { ellipseEdgeDistance, polygonSignedDistance } from "./hazards";
import { mulberry32 } from "./rng";
import { createNearestPoint } from "./spline";
import type { NearestPoint } from "./spline";
import { BLEND_WIDTH, createRoughNoise, halfWidthAt } from "./terrain";
import type { Terrain } from "./terrain";

/**
 * Metres per heightfield cell. Coarser than a hole's ~1 m because arena simulates no ball --
 * `DECISIONS.md` § "Arena mode" has the argument, and `npm run probe:terrain` has the numbers.
 */
export const COURSE_CELL_M = 2;

/**
 * How far past its own blend band a hole's ground reaches before the course rough has it all.
 *
 * Wide enough that the seam is a slope rather than a step: the two surfaces are independent noise
 * fields and can disagree by a metre or so, and a metre over 40 m is a 1.4 degree ramp.
 */
export const COURSE_BLEND_M = 40;

/** Rough beyond the outermost field, so the perimeter is ground rather than a field edge. */
export const COURSE_MARGIN_M = 40;

/** Channel for the course rough when the caller does not inject one. */
const COURSE_ROUGH_SEED = 0xc0125e;

export interface PlacedHole {
  readonly placement: HolePlacement;
  readonly spec: HoleSpec;
  readonly terrain: Terrain;
}

export interface CourseTerrainSources {
  /** Seeded PRNG for the interstitial rough. Injected -- never `Math.random` in `src/sim/**`. */
  readonly rough?: () => number;
  readonly cellM?: number;
  readonly marginM?: number;
}

export interface CourseTerrain {
  readonly holes: readonly PlacedHole[];
  readonly bounds: Bounds;
  readonly cellM: number;
  /** Cells along X and Z. The heightfield holds one more sample than cells on each axis. */
  readonly cols: number;
  readonly rows: number;
  /** Ground height at a course-frame point. */
  heightAt(x: number, z: number): number;
  /** How much the hole at `index` in `holes` owns the ground here, 0..1. */
  influenceAt(index: number, x: number, z: number): number;
  buildHeightfield(): Float32Array;
}

/** Everything about one placed hole this module needs, worked out once. */
interface HoleContext {
  readonly hole: PlacedHole;
  /** Course-frame box outside which this hole cannot influence anything. */
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

export function createCourseTerrain(
  holes: readonly PlacedHole[],
  sources: CourseTerrainSources = {},
): CourseTerrain {
  const cellM = sources.cellM ?? COURSE_CELL_M;
  const marginM = sources.marginM ?? COURSE_MARGIN_M;
  const rough = createRoughNoise(sources.rough ?? mulberry32(COURSE_ROUGH_SEED));

  const fields: PlacedField[] = holes.map((h) => ({
    fieldSize: h.spec.fieldSize,
    offsetX: h.placement.offsetX,
    offsetZ: h.placement.offsetZ,
    rotation: h.placement.rotation,
  }));
  const inner = boundsOf(fields);
  const bounds: Bounds = {
    minX: inner.minX - marginM,
    minZ: inner.minZ - marginM,
    maxX: inner.maxX + marginM,
    maxZ: inner.maxZ + marginM,
  };

  // A hole reaches at most this far from its own origin: the field's half-diagonal covers the
  // corridor, every hazard placed inside the field and the rotation sweep, and the blend adds the
  // band beyond it. Boxing per hole rather than per corridor keeps the cull cheap and honest --
  // it can only ever include a hole that turns out to have no influence, never exclude one.
  const contexts: HoleContext[] = holes.map((hole) => {
    const reach =
      (hole.spec.fieldSize / 2) * Math.SQRT2 + BLEND_WIDTH + COURSE_BLEND_M;
    return {
      hole,
      minX: hole.placement.offsetX - reach,
      maxX: hole.placement.offsetX + reach,
      minZ: hole.placement.offsetZ - reach,
      maxZ: hole.placement.offsetZ + reach,
    };
  });

  // Closure-owned scratch: every query below runs inside the fixed tick, where allocation is
  // banned, and `buildHeightfield` calls them hundreds of thousands of times.
  const localScratch = { x: 0, z: 0 };
  const nearestScratch: NearestPoint = createNearestPoint();

  /**
   * How much a hole owns a point given in its own local frame.
   *
   * 1 out to the edge of the corridor's own blend band -- where `Terrain.heightAt` has stopped
   * carving and is returning plain noise -- then smoothly to 0 a course blend further out.
   */
  function influenceLocal(context: HoleContext, localX: number, localZ: number): number {
    const { spec, terrain } = context.hole;
    terrain.spline.nearestInto(localX, localZ, nearestScratch);
    const half = halfWidthAt(spec.corridor, nearestScratch.t);
    let weight =
      1 - smoothstep01((nearestScratch.distance - half - BLEND_WIDTH) / COURSE_BLEND_M);
    if (weight >= 1) return 1;

    // Hazards hold their own ground out where the corridor has let go of it. A bunker or a pond
    // is a placed thing with a shape; fading it into rough leaves a dish half dug and, for water,
    // ground above the level the renderer draws the surface at.
    for (const poly of spec.water) {
      const signed = polygonSignedDistance(localX, localZ, poly);
      const w = 1 - smoothstep01(signed / COURSE_BLEND_M);
      if (w > weight) weight = w;
      if (weight >= 1) return 1;
    }
    for (const bunker of spec.bunkers) {
      const w = 1 - smoothstep01(ellipseEdgeDistance(localX, localZ, bunker) / COURSE_BLEND_M);
      if (w > weight) weight = w;
      if (weight >= 1) return 1;
    }
    return weight;
  }

  function influenceAt(index: number, x: number, z: number): number {
    const context = contexts[index];
    if (context === undefined) return 0;
    if (x < context.minX || x > context.maxX || z < context.minZ || z > context.maxZ) return 0;
    toHoleFrame(context.hole.placement, x, z, localScratch);
    return influenceLocal(context, localScratch.x, localScratch.z);
  }

  /**
   * The blend. Weights that sum under 1 leave the remainder to the rough; weights that sum over 1
   * -- two corridors converging on the apron -- normalise against each other instead, so the
   * answer stays between the two holes' own heights rather than climbing to their sum.
   *
   * Both branches agree at a sum of exactly 1, which is what keeps the ground continuous across
   * the line where one takes over from the other.
   */
  function heightAt(x: number, z: number): number {
    let sumWeight = 0;
    let sumHeight = 0;
    for (const context of contexts) {
      if (x < context.minX || x > context.maxX || z < context.minZ || z > context.maxZ) continue;
      toHoleFrame(context.hole.placement, x, z, localScratch);
      const influence = influenceLocal(context, localScratch.x, localScratch.z);
      if (influence <= 0) continue;
      // Cubed, so the hole a point is actually on wins it. Corridors are laid out 35 m apart at
      // the closest, and a hole's influence reaches ~65 m, so a fairway sample is usually inside
      // a neighbour's band as well -- at raw weights that neighbour's rough would drag a third of
      // a metre of camber onto ground the hole spent `validateHole` proving was flat. Cubing
      // leaves a neighbour at half influence contributing an eighth as much, keeps the falloff
      // continuous at both ends (0 and 1 are fixed points), and costs two multiplies.
      const weight = influence * influence * influence;
      sumWeight += weight;
      sumHeight += weight * context.hole.terrain.heightAt(localScratch.x, localScratch.z);
    }
    if (sumWeight <= 0) return rough(x, z);
    if (sumWeight >= 1) return sumHeight / sumWeight;
    return rough(x, z) * (1 - sumWeight) + sumHeight;
  }

  const extentX = bounds.maxX - bounds.minX;
  const extentZ = bounds.maxZ - bounds.minZ;
  const cols = Math.max(1, Math.round(extentX / cellM));
  const rows = Math.max(1, Math.round(extentZ / cellM));

  /**
   * Rapier heightfield storage is column-major: heights[row + col * (nrows + 1)]. Row index maps
   * to world Z, column index to world X -- the same convention `Terrain.buildHeightfield` uses,
   * because it is Rapier's and not this project's.
   */
  function buildHeightfield(): Float32Array {
    const heights = new Float32Array((rows + 1) * (cols + 1));
    for (let col = 0; col <= cols; col++) {
      const worldX = bounds.minX + (col / cols) * extentX;
      for (let row = 0; row <= rows; row++) {
        const worldZ = bounds.minZ + (row / rows) * extentZ;
        heights[row + col * (rows + 1)] = heightAt(worldX, worldZ);
      }
    }
    return heights;
  }

  return { holes, bounds, cellM, cols, rows, heightAt, influenceAt, buildHeightfield };
}
