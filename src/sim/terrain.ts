import { createNoise2D } from "simplex-noise";
import { legacyHoleSpec } from "./course";
import type { HoleSpec, Vec3 } from "./course";
import { hashChannel, mulberry32 } from "./rng";

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
 * Slope, not height, is what the ball actually feels. For a noise octave of amplitude A and
 * frequency f the steepest grade is roughly A * 2*pi*f, so these two constants are one knob,
 * not two. These values target ~5 deg mean / ~12 deg max. Replaced by the three-octave budget
 * formulation in §4; unchanged here so the refactor is provably behaviour-preserving.
 */
const HEIGHT_AMPLITUDE = 0.85;
const NOISE_FREQUENCY = 0.028;
const DETAIL_AMPLITUDE_RATIO = 0.15;
const DETAIL_FREQUENCY_RATIO = 2.6;

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

  function rawHeight(worldX: number, worldZ: number): number {
    return (
      noise2D(worldX * NOISE_FREQUENCY, worldZ * NOISE_FREQUENCY) * HEIGHT_AMPLITUDE +
      noise2D(
        worldX * NOISE_FREQUENCY * DETAIL_FREQUENCY_RATIO,
        worldZ * NOISE_FREQUENCY * DETAIL_FREQUENCY_RATIO,
      ) *
        HEIGHT_AMPLITUDE *
        DETAIL_AMPLITUDE_RATIO
    );
  }

  // Pad heights are sampled from the raw noise once at construction so heightAt can flatten
  // toward the terrain's own local height without recursing into itself.
  const pads: readonly Pad[] = [
    { ...spec.tee, radius: TEE_PAD_RADIUS, height: rawHeight(spec.tee.x, spec.tee.z) },
    { ...spec.cup, radius: GREEN_RADIUS, height: rawHeight(spec.cup.x, spec.cup.z) },
  ];

  /**
   * Pads blend toward the terrain height *at the pad*, not toward absolute 0. Multiplying the
   * whole height by (1 - flatten) pins a pad to y=0 regardless of where the surrounding ground
   * sits -- that left the tee on a 1.1 m pinnacle with a 26 deg drop-off inside the first 4 m.
   */
  function heightAt(worldX: number, worldZ: number): number {
    let height = rawHeight(worldX, worldZ);
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
    heightAt,
    buildHeightfield,
    teePosition: { x: spec.tee.x, y: heightAt(spec.tee.x, spec.tee.z) + 0.3, z: spec.tee.z },
    cupPosition: { x: spec.cup.x, y: heightAt(spec.cup.x, spec.cup.z), z: spec.cup.z },
  };
}

// ---------------------------------------------------------------------------------------
// Temporary compatibility shims. Every export below is the pre-refactor module surface, now
// served from one legacy Terrain instance so the build and the probe stay green while
// consumers migrate one file at a time. All of it is deleted in Task 7.
// ---------------------------------------------------------------------------------------

/** The shipped hole's literal noise source: createNoise2D(() => 0.42). */
export const LEGACY_TERRAIN_SOURCES: TerrainSources = { height: () => 0.42 };

const legacySpec = legacyHoleSpec();
const legacyTerrain = createTerrain(legacySpec, LEGACY_TERRAIN_SOURCES);

export const FIELD_SIZE = legacySpec.fieldSize;
export const NROWS = legacySpec.cells;
export const NCOLS = legacySpec.cells;
export const WATER_LEVEL = legacySpec.waterLevel;
export const TEE_XZ = legacySpec.tee;
export const CUP_XZ = legacySpec.cup;
export const TEE_POSITION = legacyTerrain.teePosition;
export const CUP_POSITION = legacyTerrain.cupPosition;

export function heightAt(worldX: number, worldZ: number): number {
  return legacyTerrain.heightAt(worldX, worldZ);
}

export function buildHeightfield(): Float32Array {
  return legacyTerrain.buildHeightfield();
}
