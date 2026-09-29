import clubhouseRaw from "./graphs/clubhouse.json";
import pickupsRaw from "./graphs/pickups.json";
import teeSignRaw from "./graphs/tee_sign.json";
import { graphFromSet, type PrimitiveGraphSet } from "./propGraphs";
import type { PrimitiveGraph, SlotColors } from "./primitiveGraph";
import type { PickupType } from "../sim/pickupSites";

/**
 * The Stage 7 kit: the clubhouse complex, the pickup items and the tee sign, all authored by
 * `art/stage7_kit.py` into `art/clubhouse-exterior.blend` and exported as parameters. Generated
 * files: re-run the kit script and re-export rather than editing the JSON.
 *
 * Specs: `docs/art/specs/clubhouse.md`, `team-barn.md`, `lot.md`, `food-cart.md`, `pickups.md`,
 * `tee-sign.md`.
 */

const SOURCE = "art/clubhouse-exterior.blend (art/stage7_kit.py)";

export const CLUBHOUSE_SET = clubhouseRaw as unknown as PrimitiveGraphSet;
export const PICKUP_SET = pickupsRaw as unknown as PrimitiveGraphSet;
export const TEE_SIGN_GRAPH = teeSignRaw as unknown as PrimitiveGraph;

export const KIT_NAMES = ["clubhouse", "team_barn", "lot_stripes", "lamp_post", "lamp_head", "food_cart"] as const;
export type KitName = (typeof KIT_NAMES)[number];

export function kitGraph(name: KitName): PrimitiveGraph {
  return graphFromSet(CLUBHOUSE_SET, name, SOURCE);
}

export { PICKUP_TYPES, type PickupType } from "../sim/pickupSites";

export function pickupGraph(type: PickupType): PrimitiveGraph {
  return graphFromSet(PICKUP_SET, type, SOURCE);
}

/**
 * The pickup set shares four slots across three items, so each item's colours are applied when it
 * is merged. `pickups.md` has the table. The drink is cyan rather than team-0 blue so it can't be
 * read as a friendly cart.
 */
export const PICKUP_COLOURS: Readonly<Record<PickupType, SlotColors>> = {
  bucket: { pickup_shell: 0x2e9e4a, pickup_fill: 0xf4f4ee, pickup_metal: 0xb8bcc0 },
  hot_dog: { pickup_shell: 0xe0a050, pickup_fill: 0xb0452a, pickup_accent: 0xf2c230 },
  drink: { pickup_shell: 0x2ec4d0, pickup_fill: 0xcfe6f5, pickup_accent: 0xf2c230 },
};
