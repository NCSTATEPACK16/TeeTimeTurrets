import type { BiomeId } from "../sim/course";
import { BIOMES } from "./biomes";
import { CLAY_COLOUR, GROUND_EDGES, STRAW_COLOUR } from "./groundShader";
import { groundNoise } from "./groundWarp";

/**
 * The course ground's palette blend, in TypeScript: what colour the shader paints a point, before
 * mow stripes and texture detail. Grass tufts (`grassCells.ts`) take their colour from it, so a
 * tuft is the colour of the ground it stands in.
 *
 * **It is a transcription of `courseBlend` in `groundShader.ts`** -- green, collar, fairway, first
 * cut, rough, pine straw, clay, bunker lip, sand, water, in that order -- and the two must change
 * together. `groundPalette.test.ts` pins the corners.
 *
 * Colours come out linear, as three's `Color.setHex` gives the shader's uniforms.
 *
 * Pure: no three.
 */

/** Biome order of the shader's palette arrays and of `biome` below. Same as `courseGround.ts`. */
export const PALETTE_BIOME_ORDER: readonly BiomeId[] = ["parkland", "links", "marsh"];

export interface GroundSample {
  readonly x: number;
  readonly z: number;
  /** The surface mask's weights, as the shader reads them: 0 on the putting green, 1 off it. */
  readonly green: number;
  /** 0 on the mown corridor, 1 in full rough. */
  readonly corridor: number;
  readonly sand: number;
  readonly water: number;
  /** Shares of the three biomes, in `PALETTE_BIOME_ORDER`. Need not sum to 1. */
  readonly biome: ArrayLike<number>;
  /** `woodsDensityAt`, 0..1. */
  readonly woods: number;
  /** The ground normal's y: 1 on the flat. */
  readonly up: number;
}

export interface LinearRgb {
  r: number;
  g: number;
  b: number;
}

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function linear(hex: number): [number, number, number] {
  return [
    srgbToLinear(((hex >> 16) & 255) / 255),
    srgbToLinear(((hex >> 8) & 255) / 255),
    srgbToLinear((hex & 255) / 255),
  ];
}

type Field = "green" | "fairway" | "rough" | "sand" | "water";
const FIELDS: readonly Field[] = ["green", "fairway", "rough", "sand", "water"];
/** [field][biome] -> linear RGB, worked out once. */
const PALETTE = Object.fromEntries(
  FIELDS.map((field) => [field, PALETTE_BIOME_ORDER.map((biome) => linear(BIOMES[biome][field]))]),
) as Record<Field, [number, number, number][]>;
const CLAY = linear(CLAY_COLOUR);
const STRAW = linear(STRAW_COLOUR);

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * How much of a point is pine straw, 0..1: the woods density through the feathered threshold,
 * scaled by the corridor weight. The shader's `straw`.
 */
export function strawAmount(x: number, z: number, woods: number, corridor: number): number {
  const e = GROUND_EDGES;
  const n = groundNoise(x / e.strawNoiseCellM, z / e.strawNoiseCellM, e.strawNoiseSalt) * e.strawNoise;
  return smoothstep(e.strawFrom, e.strawTo, woods + n) * corridor;
}

// Scratch for the five mixed palette colours.
const mixed: Record<Field, [number, number, number]> = {
  green: [0, 0, 0],
  fairway: [0, 0, 0],
  rough: [0, 0, 0],
  sand: [0, 0, 0],
  water: [0, 0, 0],
};
const blended: [number, number, number] = [0, 0, 0];

/** The colour the course ground is painted at `sample`, without stripes or detail. Never allocates. */
export function groundColourAt(sample: GroundSample, out: LinearRgb): LinearRgb {
  const e = GROUND_EDGES;
  let b0 = sample.biome[0] ?? 0;
  let b1 = sample.biome[1] ?? 0;
  let b2 = sample.biome[2] ?? 0;
  const sum = b0 + b1 + b2;
  if (sum > 0.0001) {
    b0 /= sum;
    b1 /= sum;
    b2 /= sum;
  } else {
    b0 = 1;
    b1 = 0;
    b2 = 0;
  }
  for (const field of FIELDS) {
    const p = PALETTE[field];
    const m = mixed[field];
    for (let k = 0; k < 3; k++) m[k] = p[0]![k]! * b0 + p[1]![k]! * b1 + p[2]![k]! * b2;
  }

  const wGreen = sample.green;
  const wCorridor = sample.corridor;
  const onGreen = 1 - smoothstep(e.collarFrom - e.cutSoftness, e.collarFrom + e.cutSoftness, wGreen);
  const collar = (1 - onGreen) * (1 - smoothstep(e.collarTo - e.cutSoftness, e.collarTo + e.cutSoftness, wGreen));
  const pastFairway = smoothstep(e.firstCutFrom - e.cutSoftness, e.firstCutFrom + e.cutSoftness, wCorridor);
  const wRough = smoothstep(e.firstCutTo - e.cutSoftness, e.firstCutTo + e.cutSoftness, wCorridor);
  const straw = strawAmount(sample.x, sample.z, sample.woods, wCorridor);
  const clay = 1 - smoothstep(e.clayFull, e.clayFrom, sample.up);
  const lip = smoothstep(e.lipFrom, e.lipTo, sample.sand) * (1 - smoothstep(e.lipTo, e.sandAt, sample.sand));
  const sandMix = smoothstep(e.sandAt - 0.06, e.sandAt + 0.06, sample.sand);

  const c = blended;
  for (let k = 0; k < 3; k++) {
    const fairway = mixed.fairway[k]!;
    const rough = mixed.rough[k]!;
    let mown = fairway + (mixed.green[k]! - fairway) * onGreen;
    mown += (fairway * e.collarTone - mown) * collar;
    const firstCut = fairway + (rough - fairway) * e.firstCutTone;
    let grass = mown + (firstCut - mown) * pastFairway;
    grass += (rough - grass) * wRough;
    grass += (STRAW[k]! - grass) * straw;
    grass += (CLAY[k]! - grass) * clay;
    grass *= 1 - e.lipShade * lip;
    grass += (mixed.sand[k]! - grass) * sandMix;
    grass += (mixed.water[k]! - grass) * sample.water;
    c[k] = grass;
  }
  out.r = c[0]!;
  out.g = c[1]!;
  out.b = c[2]!;
  return out;
}
