import type { BiomeId } from "../sim/course";

/**
 * The palette and prop set for each biome. Render-only: nothing here reaches `src/sim/**`, so a
 * colour change can never alter a trajectory.
 *
 * Three palettes, not eighteen -- see `biomeForIndex` in sim/course.ts for why the course routes
 * through contiguous stretches rather than giving every hole its own climate.
 *
 * **These are sampled from the biome colour sheets**, not hand-picked. Each sheet comes from its
 * prompt in docs/COURSE_PIPELINE.md section 7.1 and is read with `npm run swatches` -- median over
 * the middle of each detected rectangle, never the printed hex codes and never a single pixel. See
 * the header of tools/readSwatches.mjs for why both of those fail.
 *
 * Nine colours, not the six that section originally asked for: it listed an `out of bounds` swatch
 * this game has no surface for, and omitted `sky` and the three foliage tones, which are consumed
 * here. `treeDensity`, `treeHeight` and `treeForm` are tuned rather than sampled -- a colour sheet
 * must never change them.
 */

export interface BiomePalette {
  /** The five surface colours, matching SurfaceId. */
  readonly green: number;
  readonly fairway: number;
  readonly rough: number;
  readonly sand: number;
  readonly water: number;
  /** Sky and fog share a colour so the horizon dissolves rather than banding. */
  readonly sky: number;
  /** Foliage, in two tones -- the flat-shaded low-poly look is two tones per form. */
  readonly foliageLight: number;
  readonly foliageDark: number;
  readonly trunk: number;
  /**
   * Trees per 1000 m² of qualifying rough. Tuned per biome for character rather than for a
   * uniform look: parkland is wooded, links is nearly bare, marsh is scrubby.
   */
  readonly treeDensity: number;
  /** Metres. Drives the instanced tree's overall scale before per-instance jitter. */
  readonly treeHeight: number;
  /** Which of the three prop silhouettes a biome's tree uses. */
  readonly treeForm: "conifer" | "shrub" | "reed";
}

export const BIOMES: Readonly<Record<BiomeId, BiomePalette>> = {
  // Lush and classic -- the pine-and-creek register of the concept art.
  parkland: {
    green: 0xa2db31,
    fairway: 0x5fa53a,
    rough: 0x59823f,
    sand: 0xddbf84,
    water: 0x4a91aa,
    sky: 0x55b1ef,
    foliageLight: 0x669f34,
    foliageDark: 0x446327,
    trunk: 0x654e3e,
    treeDensity: 5.5,
    treeHeight: 7.5,
    treeForm: "conifer",
  },
  // Pale, sandy and wind-blown. The rough is marram grass, not turf, so it reads tan-green, and
  // the sky is overcast -- a links hole in full sun looks like parkland with lighter grass.
  //
  //
  // Two fields are corrected off the sheet, which put green, fairway and rough within 18 luminance
  // of each other: from the chase camera the corridor had no edge at all, and only the mowing
  // stripes -- a 7% sheen that washes out with distance -- said where the fairway was.
  //
  //   rough  0xa1996b -> 0x968f64   fairway/rough 16.6 -> 26.6 (want 25)
  //   green  0xc8bb86 -> 0xccbf89   green/fairway 17.9 -> 21.9 (want 20)
  //
  // Both are a uniform scale on all three channels, so hue and saturation are the sheet's to
  // within half a degree and a percent -- only value moves. `fairway` is deliberately untouched:
  // it is the field both pairs are measured against, and darkening it to open the green would
  // have closed the corridor edge again. Brightening `green` instead also matches what a putting
  // surface does, being mown tighter than its approach.
  links: {
    green: 0xccbf89,
    fairway: 0xb3aa74,
    rough: 0x968f64,
    sand: 0xe5cd9d,
    water: 0x6a8c98,
    sky: 0xd0d1d2,
    foliageLight: 0xc5b884,
    foliageDark: 0x8a8359,
    trunk: 0x654f42,
    treeDensity: 1.2,
    treeHeight: 2.2,
    treeForm: "shrub",
  },
  // Humid and muted. Peaty water rather than blue, and a hazy sky that flattens the distance.
  //
  // Three fields are corrected off the sheet, for two different kinds of reason. Each is a uniform
  // scale on all three channels, so only value moves; hue holds to within a degree.
  //
  //   sand   0x7c786c -> 0x979283   sand/fairway 1.2 -> 27.2
  //   water  0x473b2c -> 0x564735   lifted off near-black; still 20.3 below rough
  //   trunk  0x534940 -> 0x423a33   trunk/water 1.6 -> 13.7, against the lifted water
  //
  // `sand` is a measured failure. The sheet put it 1.2 from `fairway` in luminance, and at sat
  // 0.13 it is too near grey for its 52 degrees of hue separation to do any work -- on screen
  // those bunkers read as patches of mist lying on the turf, not as sand.
  //
  // `water` is a judgement call, not a metric one: as sampled it passes every contrast check, and
  // it is corrected because of how it looked from the chase camera, where near-black flat fill
  // read as a hole in the world rather than as a bog. It stays comfortably the darkest surface in
  // the biome, which is the sheet's whole point about this place.
  //
  // `trunk` follows from that. Lifting water alone would have left two warm browns 1.6 apart in
  // luminance and 4 degrees apart in hue -- a marsh tree standing in the bog would have dissolved
  // into it -- so the trunk drops to keep the gap it had.
  marsh: {
    green: 0xa3c240,
    fairway: 0x58863b,
    rough: 0x506441,
    sand: 0x979283,
    water: 0x564735,
    sky: 0x939e90,
    foliageLight: 0x949f62,
    foliageDark: 0x404f2b,
    trunk: 0x423a33,
    treeDensity: 3.5,
    treeHeight: 5.0,
    treeForm: "reed",
  },
};

/**
 * Mowing stripe widths, in metres. The green is mown finer and, in the shader, at a right angle
 * to the fairway -- that contrast is what makes a green read as a separate surface from across
 * the hole, before any colour difference registers.
 */
export const FAIRWAY_STRIPE_M = 4.0;
export const GREEN_STRIPE_M = 1.5;

/**
 * How far a stripe lightens and darkens the grass beneath it. Small on purpose: real mowing
 * stripes are a sheen, not a paint job, and a wide range turns the fairway into a barcode.
 */
export const STRIPE_CONTRAST = 0.07;
