import raw from "./graphs/cart.json";
import type { PrimitiveGraph } from "./primitiveGraph";

/**
 * The cart, authored in Blender against `docs/concept/reference/cart-turnaround-01.jpg` and
 * `03CartTurretChasecam.jpg` and exported through `ASSET_PIPELINE.md` section 4.3. Only parameters
 * cross the line -- there is no mesh file, so the procedural-primitives rule in `AGENTS.md` holds.
 *
 * `cart.json` is generated. Edit the Blender scene and re-export; do not hand-edit the JSON, or
 * the next export silently reverts it. `cartGraph.test.ts` guards the invariants a re-export can
 * break, and `npm run gate` guards the silhouette.
 *
 * The import is typed through `as unknown as` because TypeScript widens JSON literals to `number[]`
 * and `string`, and the graph's tuples and `version: 1` are narrower. The test file is what
 * actually checks the shape is right.
 */
export const CART_GRAPH = raw as unknown as PrimitiveGraph;

/**
 * The eight material slots from `ASSET_PIPELINE.md` section 2.1. This is the vocabulary the
 * clubhouse loadout paints in: a cosmetic is a map from these names to colours, so anything the
 * player can recolour has to be its own slot here.
 */
export const CART_SLOTS = [
  "chassis",
  "roof",
  "turret_housing",
  "turret_barrel",
  "tires",
  "rims",
  "seats",
  "club_bag",
] as const;

export type CartSlot = (typeof CART_SLOTS)[number];
