import raw from "./graphs/props.json";
import type { PrimitiveGraph, PrimitiveNode, SlotSpec } from "./primitiveGraph";

/**
 * The course props, authored in Blender against `docs/concept/reference/prop-silhouettes-01.jpg`
 * and exported through `ASSET_PIPELINE.md` §4.3's helper. Only parameters cross the line -- there is
 * no mesh file, so `AGENTS.md`'s procedural-primitives rule holds.
 *
 * `props.json` is generated. Edit the `props` collection in `art/clubhouse-and-cart.blend` and
 * re-export; do not hand-edit the JSON, or the next export silently reverts it. The flagstick is
 * **not** here: it owns a collider and a sim-side felled state, so §2.2's route rule puts it in
 * procedural TypeScript (`src/entities/Flagstick.ts`).
 *
 * **A set, not a graph.** §4.1's shape describes one asset with one root, which is what a cart is.
 * These are independent objects that share four material slots and one authoring session, so the
 * file carries `props: { name -> root node }` in place of `root`, and `graphFor` hands back a
 * §4.1 `PrimitiveGraph` per prop. The alternative was a fake container primitive in the shipped
 * graph or six props inheriting a seventh's transform.
 *
 * The slot names are all `prop_`-prefixed and share none with the cart's eight or the rider's four,
 * so `cartGraph.test.ts`'s exact-eight-slots assertion is unaffected by anything here.
 */

export interface PrimitiveGraphSet {
  readonly name: string;
  readonly version: 1;
  readonly units: "m";
  readonly slots: Readonly<Record<string, SlotSpec>>;
  readonly props: Readonly<Record<string, PrimitiveNode>>;
}

/** The import is typed through `as unknown as` for the same reason `cartGraph.ts` is: TypeScript
 *  widens JSON literals to `number[]` and `string`, and the graph's tuples and `version: 1` are
 *  narrower. `propGraphs.test.ts` is what actually checks the shape. */
export const PROP_SET = raw as unknown as PrimitiveGraphSet;

/**
 * Every prop in the set, in the order the reference sheet reads. Exported as a tuple so the gate's
 * subject list, the placement code and the test all draw from one list rather than three.
 */
export const PROP_NAMES = [
  "tee_marker",
  "bunker_rake",
  "ball_washer",
  "distance_post",
  "cart_path_sign",
  "footbridge",
] as const;

export type PropName = (typeof PROP_NAMES)[number];

/** The five slots the set declares. Deliberately disjoint from the cart's eight and the rider's four. */
export const PROP_SLOTS = [
  "prop_timber",
  "prop_timber_dark",
  "prop_paint",
  "prop_metal",
  "prop_green",
] as const;

/**
 * One prop as a standalone `PrimitiveGraph`, ready for `buildGraph` or `mergeGraph`.
 *
 * Throws rather than returning null: a missing prop means the export and the code have drifted, and
 * a prop that silently fails to appear is precisely the class of bug the gate exists to catch late
 * and this catches early.
 */
export function graphFor(name: PropName): PrimitiveGraph {
  const root = PROP_SET.props[name];
  if (!root) {
    throw new Error(
      `props.json has no prop named "${name}" (have: ${Object.keys(PROP_SET.props).join(", ")}). ` +
        `Re-export the props collection from art/clubhouse-and-cart.blend.`,
    );
  }
  return {
    name,
    version: PROP_SET.version,
    units: PROP_SET.units,
    slots: PROP_SET.slots,
    root,
  };
}
