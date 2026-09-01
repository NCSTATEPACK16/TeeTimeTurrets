import { createNoise2D } from "simplex-noise";

/**
 * Field is sized so a full-power driver lands inside it with room to roll out. The old
 * 40 m field was shorter than a single driver's carry -- a max-power shot left the map
 * in under a second without ever touching the ground (measured, tools/feelProbe.ts).
 * Grid resolution tracks field size to keep the cell ~1 m: a coarser cell makes the
 * heightfield's triangle seams big enough for the 0.15 m ball to trip over.
 */
export const FIELD_SIZE = 160;
export const NROWS = 160;
export const NCOLS = 160;

/**
 * Slope, not height, is what the ball actually feels. For a noise octave of amplitude A
 * and frequency f the steepest grade is roughly A * 2*pi*f, so these two constants are one
 * knob, not two. The previous 1.6 / 0.06 pair measured out at 19 deg mean / 44 deg max --
 * a ski slope. Real fairways run 2-8% (1-5 deg) and even dramatic links terrain stays
 * under ~15% (8.5 deg) on playable ground. These values target ~5 deg mean / ~12 deg max.
 */
const HEIGHT_AMPLITUDE = 0.85;
const NOISE_FREQUENCY = 0.028;

/**
 * Detail octave. Its slope contribution is (amplitude ratio * frequency ratio) of the base
 * octave's, so the old 0.25 amplitude at 3x frequency added 75% as much grade as the base
 * layer -- most of the roughness came from here, not from HEIGHT_AMPLITUDE. At 0.15 / 2.6
 * it contributes 39%: still visible relief, but the surface stays puttable.
 */
const DETAIL_AMPLITUDE_RATIO = 0.15;
const DETAIL_FREQUENCY_RATIO = 2.6;

const noise2D = createNoise2D(() => 0.42);

/**
 * Water is simply "terrain below a level", which means ponds form on their own in the
 * course's low ground rather than needing authored placement. Renders as one translucent
 * plane at this height. Keep it below every pad height or the tee/green flood.
 */
export const WATER_LEVEL = -0.72;

export interface Vec2 {
  x: number;
  z: number;
}

const TEE_INSET = 12;
export const TEE_XZ: Vec2 = { x: -FIELD_SIZE / 2 + TEE_INSET, z: 0 };
export const CUP_XZ: Vec2 = { x: FIELD_SIZE / 2 - 25, z: 8 };

/** Real cups are 108 mm. Oversized here: this is an arcade game read from a chase camera. */
export const CUP_RADIUS = 0.55;

/**
 * Flat pads blended into the terrain. The tee needs one so the ball starts level; the green
 * needs a much larger one because a putting surface that inherits the base noise is not
 * puttable. Everything else is left as generated.
 */
interface Pad {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly height: number;
}

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

/**
 * Pad heights are sampled from the raw noise once at module load so `heightAt` can flatten
 * toward the terrain's own local height without recursing into itself.
 */
export const GREEN_RADIUS = 11;
const TEE_PAD_RADIUS = 5;

const PADS: readonly Pad[] = [
  { ...TEE_XZ, radius: TEE_PAD_RADIUS, height: rawHeight(TEE_XZ.x, TEE_XZ.z) },
  { ...CUP_XZ, radius: GREEN_RADIUS, height: rawHeight(CUP_XZ.x, CUP_XZ.z) },
];

/** Smoothstep: C1-continuous, so a pad edge has no slope discontinuity ring. */
function smoothstep01(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/**
 * Shared height function so physics collider and render mesh never drift apart.
 *
 * Pads blend toward the terrain height *at the pad*, not toward absolute 0. An earlier
 * version multiplied the whole height by (1 - flatten), which pins a pad to y=0 regardless
 * of where the surrounding ground sits -- that left the tee on a 1.1 m pinnacle with a
 * 26 deg drop-off inside the first 4 m (measured).
 */
export function heightAt(worldX: number, worldZ: number): number {
  let height = rawHeight(worldX, worldZ);
  for (const pad of PADS) {
    const distance = Math.hypot(worldX - pad.x, worldZ - pad.z);
    if (distance >= pad.radius) continue;
    const weight = smoothstep01(1 - distance / pad.radius);
    height += (pad.height - height) * weight;
  }
  return height;
}

/**
 * Rapier heightfield storage is column-major: heights[row + col * (nrows + 1)].
 * Row index maps to world Z, column index maps to world X (see main.ts alignment notes).
 */
export function buildHeightfield(): Float32Array {
  const heights = new Float32Array((NROWS + 1) * (NCOLS + 1));
  for (let col = 0; col <= NCOLS; col++) {
    const worldX = (col / NCOLS - 0.5) * FIELD_SIZE;
    for (let row = 0; row <= NROWS; row++) {
      const worldZ = (row / NROWS - 0.5) * FIELD_SIZE;
      heights[row + col * (NROWS + 1)] = heightAt(worldX, worldZ);
    }
  }
  return heights;
}

export const TEE_POSITION = { x: TEE_XZ.x, y: heightAt(TEE_XZ.x, TEE_XZ.z) + 0.3, z: TEE_XZ.z };
export const CUP_POSITION = { x: CUP_XZ.x, y: heightAt(CUP_XZ.x, CUP_XZ.z), z: CUP_XZ.z };
