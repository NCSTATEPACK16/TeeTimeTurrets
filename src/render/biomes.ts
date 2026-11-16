import type { BiomeId } from "../sim/course";

/**
 * The palette and prop set for each biome. Render-only: nothing here reaches `src/sim/**`, so a
 * colour change can never alter a trajectory.
 *
 * Three palettes, not eighteen -- see `biomeForIndex` in sim/course.ts for why the course routes
 * through contiguous stretches rather than giving every hole its own climate.
 *
 * **Since 15 Nov 2026 the three are variations of one course**, tuned by hand around the parkland
 * sheet under the two rules stated at `BIOMES` below. What follows describes how the parkland
 * values were first obtained.
 *
 * **They were sampled from the biome colour sheets**, not hand-picked. Each sheet comes from its
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
   * Trees per 1000 m² of qualifying rough. Every stretch is wooded; the open upland is a little
   * thinner.
   */
  readonly treeDensity: number;
  /** Metres. Drives the instanced tree's overall scale before per-instance jitter. */
  readonly treeHeight: number;
  /** Which of the three prop silhouettes a biome's tree uses. */
  readonly treeForm: "conifer" | "shrub" | "reed";
}

export const BIOMES: Readonly<Record<BiomeId, BiomePalette>> = {
  // **One course, three variations** (the Caswell spec, section 3.1). The routing is traced from a
  // Carolina Piedmont pine course, and until 15 Nov 2026 these were three climates from an
  // invented course bible: parkland, a tan Scottish links with gorse, and a marsh with reeds for
  // trees. Six holes of the eighteen looked like another continent. They are now the same place
  // in slightly different light, and the ids are only names for stretches of the routing.
  //
  // Two rules, both checked by `biomes.test.ts`:
  //   - between variations, green, fairway and rough differ by at most 6 in luminance, so no
  //     border shows where one stretch meets the next;
  //   - within one, fairway stands at least 25 over rough, green 20 over fairway, sand 25 over
  //     fairway (Rec. 709 on sRGB bytes, the measure `npm run swatches` reports).
  //
  // `parkland` is the base and still the colour sheet's values, except `rough`, darkened from
  // 0x59823f so pine straw has room beneath it, and `sand`, lightened toward the pale bunkers of
  // a parkland course. `water` only tints the pond bed, which shows at the shoreline; the pond
  // surface draws itself (`render/water.ts`).
  //
  // Pine upland: holes 1-5 and 16-18.
  parkland: {
    green: 0xa2db31,
    fairway: 0x5fa53a,
    rough: 0x4f7a3a,
    sand: 0xe2cfa0,
    water: 0x3f5560,
    sky: 0x55b1ef,
    foliageLight: 0x5f9636,
    foliageDark: 0x3c5c28,
    trunk: 0x6b4a36,
    treeDensity: 5.5,
    treeHeight: 10,
    treeForm: "conifer",
  },
  // Open upland: holes 6-11. A touch warmer and sunnier, the pines a little thinner.
  links: {
    green: 0xa4dc34,
    fairway: 0x63a73b,
    rough: 0x547d3a,
    sand: 0xe2cfa0,
    water: 0x3f5560,
    sky: 0x55b1ef,
    foliageLight: 0x679a38,
    foliageDark: 0x42602a,
    trunk: 0x6b4a36,
    treeDensity: 4.0,
    treeHeight: 10,
    treeForm: "conifer",
  },
  // Bottomland: holes 12-15, where most of the ponds are. A touch deeper and cooler.
  marsh: {
    green: 0x9fd930,
    fairway: 0x5ca239,
    rough: 0x4c773a,
    sand: 0xdcc898,
    water: 0x3f5560,
    sky: 0x55b1ef,
    foliageLight: 0x588c36,
    foliageDark: 0x36542a,
    trunk: 0x5e4333,
    treeDensity: 5.0,
    treeHeight: 9,
    treeForm: "conifer",
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
