import treesRaw from "./graphs/trees.json";
import dressingRaw from "./graphs/dressing.json";
import horizonRaw from "./graphs/horizon.json";
import courseKitRaw from "./graphs/course_kit.json";
import { graphFromSet, type PrimitiveGraphSet } from "./propGraphs";
import type { PrimitiveGraph } from "./primitiveGraph";
import type { DressingKind } from "../sim/clubhouseLayout";

/**
 * The Stage 5a environment kit, authored by `art/stage5_kit.py` into `art/environment.blend` and
 * exported as parameters. Generated files: re-run the kit script and re-export rather than editing
 * the JSON. Specs: `docs/art/specs/stage5/`.
 */

const SOURCE = "art/environment.blend (art/stage5_kit.py)";

export const TREE_SET = treesRaw as unknown as PrimitiveGraphSet;

/**
 * Two species per biome, keyed by `BiomePalette.treeForm` so no palette changes (`trees.md`).
 * Every species is authored at unit height with its origin at ground contact, and its three slots
 * (`tree_trunk`, `tree_foliage_dark`, `tree_foliage_light`) take the biome's colours when merged.
 */
export const TREE_SPECIES = {
  conifer: ["conifer_tall", "broadleaf_oak"],
  shrub: ["gorse_mound", "pine_windbent"],
  reed: ["willow_weeping", "reed_clump"],
} as const;

export type TreeSpecies = (typeof TREE_SPECIES)[keyof typeof TREE_SPECIES][number];

export function treeGraph(name: TreeSpecies): PrimitiveGraph {
  return graphFromSet(TREE_SET, name, SOURCE);
}

/** The clubhouse dressing (`clubhouse-dressing.md`), keyed by the kinds `DRESSING_PLACEMENTS` places. */
export const DRESSING_SET = dressingRaw as unknown as PrimitiveGraphSet;

export function dressingGraph(kind: DressingKind): PrimitiveGraph {
  return graphFromSet(DRESSING_SET, kind, SOURCE);
}

/** The horizon hill cards (`horizon-hills.md`): one prism each, origin at the base centre. */
export const HORIZON_SET = horizonRaw as unknown as PrimitiveGraphSet;

export const HILL_NAMES = ["hill_a", "hill_b", "hill_c"] as const;
export type HillName = (typeof HILL_NAMES)[number];

export function hillGraph(name: HillName): PrimitiveGraph {
  return graphFromSet(HORIZON_SET, name, SOURCE);
}

/**
 * The course kit (`course-kit.md`), exported here and placed by later issues: stakes by #52, risers
 * by #58, kerbs and bollards by #59, reeds and rocks by #55. Origin at ground contact; the tiled
 * modules run 2.0 m along z, centred on the origin.
 */
export const COURSE_KIT_SET = courseKitRaw as unknown as PrimitiveGraphSet;

export const COURSE_KIT_NAMES = [
  "zone_stake",
  "tee_riser",
  "path_kerb",
  "path_bollard",
  "pond_reeds",
  "rock_a",
  "rock_b",
  "rock_c",
] as const;
export type CourseKitName = (typeof COURSE_KIT_NAMES)[number];

export function courseKitGraph(name: CourseKitName): PrimitiveGraph {
  return graphFromSet(COURSE_KIT_SET, name, SOURCE);
}
