import { createNoise2D } from "simplex-noise";
import type { HoleSpec, Vec3 } from "./course";
import { hashChannel, mulberry32 } from "./rng";
import { createNearestPoint, createSpline } from "./spline";
import type { NearestPoint, Spline } from "./spline";

/**
 * The height field, as a factory over one HoleSpec.
 *
 * `heightAt` is a pure function of (x, z) for a given hole and must stay one: that is what lets
 * the authoritative server evaluate terrain without replicating a mesh or a spatial index. A
 * closure over immutable spec data preserves purity; an object with mutable state would not.
 * That is why this is `createTerrain(spec)` returning a closure rather than a `Terrain` class.
 */

/** Real cups are 108 mm. Oversized here: this is an arcade game read from a chase camera. */
export const CUP_RADIUS = 0.55;

/**
 * Flat pads blended into the terrain. The tee needs one so the ball starts level; the green
 * needs a much larger one because a putting surface that inherits the base noise is not
 * puttable.
 */
export const GREEN_RADIUS = 11;
const TEE_PAD_RADIUS = 5;

/**
 * The mown corridor, and the graded edge into rough. Full rough begins at 25 m, against the
 * hard 26 m step the shipped fairway had -- about as wide as before, but graded.
 */
export const HALF_WIDTH = 15;
export const BLEND_WIDTH = 10;
export const GREEN_BLEND = 6;

/**
 * Slope budgets, as tan(theta). GRAD_GREEN and GRAD_FAIRWAY are the `crr` values already in
 * SURFACES: the rest condition surfaces.ts documents is crr >= tan(theta), so a surface's
 * rolling resistance *is* the steepest grade a ball will hold on it.
 *
 * GRAD_ROUGH is deliberately 0.28, above the rough's own 0.22 rest threshold. It is the
 * unmasked octave sum (0.03 + 0.07 + 0.18), so the rough simply runs unbudgeted -- a ball on a
 * steep rough patch keeps rolling rather than settling, which is wanted: it runs out onto
 * flatter ground instead of parking on a hillside.
 */
export const GRAD_GREEN = 0.06;
export const GRAD_FAIRWAY = 0.11;
export const GRAD_ROUGH = 0.28;

/**
 * Max ||grad S|| of the installed simplex-noise build, measured directly rather than derived:
 * central differences at h = 1e-4 over 1,002,001 samples of a 20x20 domain gave max 7.333
 * (rms 2.955, mean 2.672).
 *
 * Neither published figure was right -- the research's 2.5 is the *mean* gradient, and this
 * module previously used 2*pi. Every amplitude below solves A = G / (f * k) with this k, so it
 * is a property of the installed dependency that a version bump can silently invalidate. That
 * is why `npm run probe` asserts it rather than this comment being the only record.
 */
export const NOISE_MAX_GRADIENT = 7.333;

/** Three octaves. G is the octave's share of the slope budget; A solves A = G / (f * k). */
const F_MICRO = 0.1;
const F_MESO = 0.02;
const F_MACRO = 0.005;
const G_MICRO = 0.03;
const G_MESO = 0.07;
const G_MACRO = 0.18;
const A_MICRO = G_MICRO / (F_MICRO * NOISE_MAX_GRADIENT);
const A_MESO = G_MESO / (F_MESO * NOISE_MAX_GRADIENT);
const A_MACRO = G_MACRO / (F_MACRO * NOISE_MAX_GRADIENT);

/** Smoothstep: C1-continuous, so a pad edge has no slope discontinuity ring. */
export function smoothstep01(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/**
 * Injected randomness for the noise permutation. Defaulted from the spec's seed channel; the
 * parameter exists because AGENTS.md wants seeded randomness injected rather than reached for,
 * and because the §3 refactor has to reproduce the shipped hole's literal noise source exactly.
 */
export interface TerrainSources {
  readonly height: () => number;
}

export interface Terrain {
  readonly spec: HoleSpec;
  readonly spline: Spline;
  heightAt(x: number, z: number): number;
  buildHeightfield(): Float32Array;
  readonly teePosition: Vec3;
  readonly cupPosition: Vec3;
}

interface Pad {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly height: number;
}

/** Channel 0 of the spec's seed. See the spec's channel table, §3 "Seeding". */
export function heightChannel(spec: HoleSpec): number {
  return hashChannel(spec.seed, spec.index, 0);
}

export function createTerrain(spec: HoleSpec, sources?: TerrainSources): Terrain {
  const random = sources?.height ?? mulberry32(heightChannel(spec));
  const noise2D = createNoise2D(random);

  const spline = createSpline(spec.control);

  // Closure-owned scratch: heightAt runs inside the fixed tick, where allocation is banned.
  const nearestScratch: NearestPoint = createNearestPoint();

  /**
   * The slope a point is allowed, blended green -> fairway -> rough. `corridorDistance` is the
   * distance to the centreline, passed in rather than measured here so the carving code can ask
   * for the budget *at the centreline* (distance 0) without a second spline query.
   */
  function budgetAt(worldX: number, worldZ: number, corridorDistance: number): number {
    const toCup = Math.hypot(worldX - spec.cup.x, worldZ - spec.cup.z);
    const tGreen = smoothstep01((toCup - GREEN_RADIUS) / GREEN_BLEND);
    const tCorridor = smoothstep01((corridorDistance - HALF_WIDTH) / BLEND_WIDTH);
    const mown = GRAD_GREEN + (GRAD_FAIRWAY - GRAD_GREEN) * tGreen;
    return mown + (GRAD_ROUGH - mown) * tCorridor;
  }

  /**
   * Each octave takes what the budget leaves. Micro is never masked -- it is the surface
   * ripple, and 0.03 fits under even the green's 0.06.
   *
   * smoothstep01, not a raw clamp, on the scale terms: a clamp is C0 but not C1, and a mask
   * whose derivative steps produces a slope discontinuity in H. smoothstep01 has zero
   * derivative at both ends, so H stays C1.
   *
   * The budget is the design target, not the guarantee -- it assumes all three octaves peak at
   * the same coordinate, and smoothstep01(t) > t for t > 0.5 lets the transition band sit
   * slightly over. The rejection sampler in course.ts is the enforcement.
   */
  function noiseHeightAt(worldX: number, worldZ: number, corridorDistance: number): number {
    let remaining = budgetAt(worldX, worldZ, corridorDistance) - G_MICRO;
    const mesoScale = smoothstep01(remaining / G_MESO);
    remaining -= mesoScale * G_MESO;
    const macroScale = smoothstep01(remaining / G_MACRO);
    return (
      A_MICRO * noise2D(worldX * F_MICRO, worldZ * F_MICRO) +
      A_MESO * noise2D(worldX * F_MESO, worldZ * F_MESO) * mesoScale +
      A_MACRO * noise2D(worldX * F_MACRO, worldZ * F_MACRO) * macroScale
    );
  }

  // Pad heights are sampled from the base noise once at construction so heightAt can flatten
  // toward the terrain's own local height without recursing into itself. The pad centres sit on
  // the corridor, so distance 0 is correct and avoids a second spline query at construction.
  const pads: readonly Pad[] = [
    { ...spec.tee, radius: TEE_PAD_RADIUS, height: noiseHeightAt(spec.tee.x, spec.tee.z, 0) },
    { ...spec.cup, radius: GREEN_RADIUS, height: noiseHeightAt(spec.cup.x, spec.cup.z, 0) },
  ];

  /**
   * Pads blend toward the terrain height *at the pad*, not toward absolute 0. Multiplying the
   * whole height by (1 - flatten) pins a pad to y=0 regardless of where the surrounding ground
   * sits -- that left the tee on a 1.1 m pinnacle with a 26 deg drop-off inside the first 4 m.
   */
  function heightAt(worldX: number, worldZ: number): number {
    spline.nearestInto(worldX, worldZ, nearestScratch);
    let height = noiseHeightAt(worldX, worldZ, nearestScratch.distance);
    for (const pad of pads) {
      const distance = Math.hypot(worldX - pad.x, worldZ - pad.z);
      if (distance >= pad.radius) continue;
      const weight = smoothstep01(1 - distance / pad.radius);
      height += (pad.height - height) * weight;
    }
    return height;
  }

  /**
   * Rapier heightfield storage is column-major: heights[row + col * (nrows + 1)]. Row index
   * maps to world Z, column index maps to world X.
   */
  function buildHeightfield(): Float32Array {
    const n = spec.cells;
    const heights = new Float32Array((n + 1) * (n + 1));
    for (let col = 0; col <= n; col++) {
      const worldX = (col / n - 0.5) * spec.fieldSize;
      for (let row = 0; row <= n; row++) {
        const worldZ = (row / n - 0.5) * spec.fieldSize;
        heights[row + col * (n + 1)] = heightAt(worldX, worldZ);
      }
    }
    return heights;
  }

  return {
    spec,
    spline,
    heightAt,
    buildHeightfield,
    teePosition: { x: spec.tee.x, y: heightAt(spec.tee.x, spec.tee.z) + 0.3, z: spec.tee.z },
    cupPosition: { x: spec.cup.x, y: heightAt(spec.cup.x, spec.cup.z), z: spec.cup.z },
  };
}
