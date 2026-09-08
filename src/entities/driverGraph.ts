import raw from "./graphs/driver.json";
import type { PrimitiveGraph } from "./primitiveGraph";

/**
 * The rider: a seated segmented mannequin, authored in Blender's `driver` collection beside the
 * cart and exported through `ASSET_PIPELINE.md` section 4.3. Fifteen primitives, no rigid bodies,
 * no mesh file.
 *
 * `driver.json` is generated. Edit the Blender scene and re-export; `driverGraph.test.ts` guards
 * what a re-export can break.
 *
 * **Why this is Blender and section 2.2's mannequin is not.** That section rules the mannequin
 * procedural TypeScript because for the *ragdoll targets* the physics rig is the character rig --
 * every visible segment is a Rapier body, so the code that builds the bodies has to own the
 * shapes. The rider has no bodies. He is decoration bolted to the cart, posed once against the
 * seat, the wheel and the canopy, and he belongs in the same authoring tool as the seat, the
 * wheel and the canopy. Section 2.2 is amended to say so.
 *
 * Deliberately its own graph rather than more nodes in `cart.json`: `cartGraph.test.ts` asserts
 * the cart declares *exactly* the eight material slots the loadout paints in, and a rider needs
 * four of his own. Keeping them separate is also what lets a cart be built without a rider.
 */
export const CART_RIDER_GRAPH = raw as unknown as PrimitiveGraph;

/** Alias matching `CART_GRAPH`'s naming, which is how every caller refers to it. */
export const DRIVER_GRAPH = CART_RIDER_GRAPH;

/**
 * The rider's own material slots. Not the cart's eight, and deliberately disjoint from them: a
 * chassis repaint must not reach the rider's trousers.
 */
export const DRIVER_SLOTS = ["skin", "shirt", "trousers", "cap"] as const;

export type DriverSlot = (typeof DRIVER_SLOTS)[number];
