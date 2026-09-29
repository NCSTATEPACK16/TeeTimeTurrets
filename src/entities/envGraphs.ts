import treesRaw from "./graphs/trees.json";
import dressingRaw from "./graphs/dressing.json";
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
