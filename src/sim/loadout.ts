import { TireType } from "./entities/Cart";

/**
 * The cosmetics taxonomy behind image 11: turret skin, chassis paint, tire type.
 *
 * DOM-free and render-free, like everything under `src/sim/**`. A cosmetic here is nothing but a
 * map from `ASSET_PIPELINE.md` section 2.1 material-slot names to colours, which is exactly what
 * `GolfClub.setSlotColors` takes -- so equipping a paint is one call and no mesh changes.
 *
 * **Tire type is a stat, not a skin** (`ROADMAP.md` Phase 3.5). `TireType` and `TIRE_TUNING`
 * already live in `entities/Cart.ts` and genuinely change how the cart handles, so the options
 * below *name that enum* rather than describing tires of their own. That is the whole reason the
 * clubhouse cannot sell a tire the physics has never heard of.
 */

export interface CosmeticOption {
  readonly id: string;
  readonly label: string;
  /** Coins. The first option of each category is 0: a player owns their starting cart. */
  readonly price: number;
  /** Swatch colour for the UI. Usually the dominant slot colour. */
  readonly swatch: number;
  /** Slot name -> 0xRRGGBB, applied over the graph's declared defaults. */
  readonly slots: Readonly<Record<string, number>>;
}

/** A tire carries tuning instead of colours -- it is the one purchase that changes handling. */
export interface TireOption {
  readonly id: string;
  readonly label: string;
  readonly price: number;
  readonly swatch: number;
  readonly tire: TireType;
  /** Shown on the card so the trade is legible before it is bought. */
  readonly note: string;
}

export const CHASSIS_PAINTS: readonly CosmeticOption[] = [
  {
    id: "clubhouse",
    label: "CLUBHOUSE CREAM",
    price: 0,
    swatch: 0xefecdf,
    slots: { chassis: 0xefecdf, roof: 0xf5f4ef },
  },
  {
    id: "sunset",
    label: "SUNSET ORANGE",
    price: 900,
    swatch: 0xef8a2b,
    slots: { chassis: 0xef8a2b, roof: 0xf3d9a4 },
  },
  {
    id: "fairway",
    label: "FAIRWAY GREEN",
    price: 900,
    swatch: 0x2f6f4f,
    slots: { chassis: 0x2f6f4f, roof: 0xdfe8dc },
  },
  {
    id: "marshal",
    label: "MARSHAL BLUE",
    price: 1400,
    swatch: 0x2d5fa8,
    slots: { chassis: 0x2d5fa8, roof: 0xe6ecf5 },
  },
];

export const TURRET_SKINS: readonly CosmeticOption[] = [
  {
    id: "range-red",
    label: "RANGE RED",
    price: 0,
    swatch: 0xc4382f,
    slots: { turret_housing: 0xc4382f, turret_barrel: 0xcccdd0 },
  },
  {
    id: "olive",
    label: "OLIVE DRAB",
    price: 700,
    swatch: 0x5c6b3f,
    slots: { turret_housing: 0x5c6b3f, turret_barrel: 0x9aa08f },
  },
  {
    id: "chrome",
    label: "CHROME",
    price: 1600,
    swatch: 0xc9cdd4,
    slots: { turret_housing: 0xc9cdd4, turret_barrel: 0xe4e7ea },
  },
];

export const TIRE_OPTIONS: readonly TireOption[] = [
  {
    id: "street",
    label: "STREET",
    price: 0,
    swatch: 0x16161a,
    tire: TireType.Street,
    note: "Balanced. No penalty, no edge.",
  },
  {
    id: "knobby",
    label: "KNOBBY",
    price: 1100,
    swatch: 0x2a2a2f,
    tire: TireType.Knobby,
    note: "Barely notices rough or sand. Gives up top speed.",
  },
  {
    id: "turf",
    label: "TURF",
    price: 1100,
    swatch: 0x3a4a34,
    tire: TireType.Turf,
    note: "Fastest and grippiest on fairway. Worst in a bunker.",
  },
];

export interface Loadout {
  paint: string;
  skin: string;
  tire: string;
}

export function createLoadout(): Loadout {
  return {
    paint: CHASSIS_PAINTS[0]!.id,
    skin: TURRET_SKINS[0]!.id,
    tire: TIRE_OPTIONS[0]!.id,
  };
}

/**
 * Flattens an equipped loadout into the single override map the renderer takes.
 *
 * Skin is merged after paint deliberately: if both categories ever name the same slot, the one
 * the player picked *for the turret* is the one that should show.
 */
export function slotColorsFor(loadout: Loadout): Record<string, number> {
  const paint = CHASSIS_PAINTS.find((p) => p.id === loadout.paint) ?? CHASSIS_PAINTS[0]!;
  const skin = TURRET_SKINS.find((s) => s.id === loadout.skin) ?? TURRET_SKINS[0]!;
  return { ...paint.slots, ...skin.slots };
}

/** The sim-facing half: what `CartOptions.tire` should be set to. */
export function tireTypeFor(loadout: Loadout): TireType {
  return (TIRE_OPTIONS.find((t) => t.id === loadout.tire) ?? TIRE_OPTIONS[0]!).tire;
}
