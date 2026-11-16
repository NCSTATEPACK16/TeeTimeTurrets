/**
 * The ground's detail layers: their order in the packed texture arrays, and how each is sampled.
 *
 * Textures are **detail, not colour** (`docs/superpowers/specs/2026-11-15-caswell-look-and-grass-
 * detail-design.md` §3.3). A layer's colour map is reduced offline to its luminance over its own
 * mean, a number near 1 that multiplies the palette colour, so the palette and its tuned
 * contrasts survive. `tools/textures/packGround.mjs` packs the arrays in this order, and
 * `groundTextures.test.ts` checks the packed manifest against this table.
 *
 * Pure: no three, so the shader, the loader and the tests can all read it.
 */
export interface GroundLayer {
  readonly name: string;
  /** Metres of ground one repeat of the texture covers. */
  readonly scaleM: number;
  /** 0 = flat palette colour, 1 = the texture's full light-and-dark pattern. */
  readonly strength: number;
}

export const GROUND_LAYERS: readonly GroundLayer[] = [
  { name: "mown", scaleM: 3.2, strength: 0.55 },
  { name: "coarse", scaleM: 4.0, strength: 0.55 },
  { name: "sand", scaleM: 2.4, strength: 0.7 },
  { name: "clay", scaleM: 3.0, strength: 0.6 },
  // Until the pine-straw set lands (plan Task 5) this layer is packed from clay's files.
  { name: "straw", scaleM: 2.6, strength: 0.7 },
];

/** Layer indices into both arrays. */
export const LAYER = { mown: 0, coarse: 1, sand: 2, clay: 3, straw: 4 } as const;

/** Pixels per side of every packed layer. */
export const GROUND_TEXTURE_SIZE = 512;

/** A second, much larger sample of the same layer: breaks up visible tiling from the chase camera. */
export const MACRO_SCALE_M = 27;
export const MACRO_STRENGTH = 0.35;

/** Detail fades out between these distances from the camera, so far ground is the flat palette. */
export const DETAIL_FADE_START_M = 70;
export const DETAIL_FADE_END_M = 150;

/**
 * How a packed detail byte maps back to the multiplier: `byte / 255 * DETAIL_RANGE`. A byte of
 * 127.5 is exactly 1 (no change), and detail up to 2x fits.
 */
export const DETAIL_RANGE = 2;
