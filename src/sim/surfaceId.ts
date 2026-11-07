/**
 * Which material a point of ground is. A leaf module on purpose: `surfaces.ts` (the material
 * tuning) and `mobility.ts` (what a material does to a cart) both key tables by it, and
 * `surfaces.ts` reads the mobility table to derive cart speed. With the enum in either of them that
 * would be a value-import cycle. `surfaces.ts` re-exports it, so importers need not know.
 */
export enum SurfaceId {
  Green = "green",
  Fairway = "fairway",
  Rough = "rough",
  Sand = "sand",
  Water = "water",
  /**
   * The drivable crossing: a causeway carrying the corridor over water (spec D5). Deck and
   * shoulders alike -- the shoulders are ground the causeway raised above the pond, and a cart
   * standing on one must not be charged a water stroke for it.
   */
  Bridge = "bridge",
}
