import { PAD_OFFSET_M, PAD_SLOT_SPACING_M, PAD_SLOTS } from "./spawn";
import type { Vec2 } from "./mapGeometry";

/**
 * Where each piece of the clubhouse complex stands, relative to the clubhouse centre
 * (`AUTHORED_CLUBHOUSE`). The numbers come from `docs/art/specs/`: `clubhouse.md`, `team-barn.md`,
 * `lot.md` and `food-cart.md`.
 *
 * This is pure data in `src/sim/**` so the renderer (`src/render/clubhouse.ts`) and the static
 * colliders that come later read one table and cannot drift apart. Nothing here is simulated yet.
 *
 * Frame: +z is the clubhouse front, toward the course; team 0's pads are at -x.
 */

/** A placed piece: its offset from the clubhouse centre and its yaw about +Y, radians. */
export interface KitPlacement {
  readonly dx: number;
  readonly dz: number;
  readonly yaw: number;
}

export const CLUBHOUSE_PLACEMENT: KitPlacement = { dx: 0, dz: 0, yaw: 0 };

/** Pad rows run +z from the clubhouse centre; a barn is centred on its row, outboard of it. */
const PAD_ROW_MID_Z = ((PAD_SLOTS - 1) * PAD_SLOT_SPACING_M) / 2;
/** Pad at 25 m, then a 4 m apron, then half the barn's 8 m depth. */
export const BARN_OFFSET_X = PAD_OFFSET_M + 4 + 4;

/**
 * `[team]`. The barn graph is authored with its open face at +x, so team 0's (west) barn faces
 * east at yaw 0 and team 1's is turned to face west.
 */
export const BARN_PLACEMENTS: readonly [KitPlacement, KitPlacement] = [
  { dx: -BARN_OFFSET_X, dz: PAD_ROW_MID_Z, yaw: 0 },
  { dx: BARN_OFFSET_X, dz: PAD_ROW_MID_Z, yaw: Math.PI },
];

/** The food cart, 9 m in front of the verandah steps. The pickup depot ring is centred on it. */
export const FOOD_CART_PLACEMENT: KitPlacement = { dx: 0, dz: 16, yaw: 0 };

/** The lot behind the building: north edge 2 m off the rear wall, 6 m deep. */
export const LOT_PLACEMENT: KitPlacement = { dx: 0, dz: -12, yaw: 0 };

/** Four lamps at the lot corners and aisle ends. Each faces its arm toward the lot's centre line. */
export const LAMP_PLACEMENTS: readonly KitPlacement[] = [
  { dx: -11, dz: -9, yaw: Math.PI },
  { dx: 11, dz: -9, yaw: Math.PI },
  { dx: -11, dz: -15, yaw: 0 },
  { dx: 11, dz: -15, yaw: 0 },
];

/** Pickup depot ring: radius and centre (`docs/art/specs/pickups.md`). */
export const DEPOT_RADIUS_M = 6;
/** The scatter keeps this far from the depot centre, so it doesn't crowd the ring. */
export const DEPOT_CLEAR_M = 20;

/** World position of a placement about `centre`. */
export function placedAt(centre: Vec2, p: KitPlacement): Vec2 {
  return { x: centre.x + p.dx, z: centre.z + p.dz };
}
