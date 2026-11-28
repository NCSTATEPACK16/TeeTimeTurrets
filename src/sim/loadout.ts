import { TireType } from "./entities/Cart";
import { hashChannel } from "./rng";

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
    slots: { chassis: 0xefecdf },
  },
  // `sunset` and `marshal` were orange and blue, close enough to the team canopies (blue
  // 0x2f7be0, orange 0xf07a1a) to blur which side a cart was on (BACKLOG #49). Retuned in Stage 8;
  // the ids and prices are kept so a saved profile still owns them.
  {
    id: "sunset",
    label: "SUNSET PLUM",
    price: 900,
    swatch: 0x7a3b69,
    slots: { chassis: 0x7a3b69 },
  },
  {
    id: "fairway",
    label: "FAIRWAY GREEN",
    price: 900,
    swatch: 0x2f6f4f,
    slots: { chassis: 0x2f6f4f },
  },
  {
    id: "marshal",
    label: "MARSHAL SLATE",
    price: 1400,
    swatch: 0x55606b,
    slots: { chassis: 0x55606b },
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

/**
 * A bot's look: a paint and a skin picked from the cart's index and the match seed, so a bot
 * keeps its look through a match and its rematch (Stage 8). Render-only: a bot's stats are the
 * default kit whatever it wears. The tyre stays the default, which is what bots drive on.
 */
export function botLoadout(index: number, seed: number): Loadout {
  const h = hashChannel(seed, BOT_LOOK_CHANNEL, index);
  return {
    paint: CHASSIS_PAINTS[h % CHASSIS_PAINTS.length]!.id,
    skin: TURRET_SKINS[(h >>> 8) % TURRET_SKINS.length]!.id,
    tire: TIRE_OPTIONS[0]!.id,
  };
}

/** `hashChannel`'s channel for bot looks. Distinct from the sim's streams; it never feeds the sim. */
const BOT_LOOK_CHANNEL = 0x100c;

/** The sim-facing half: what `CartOptions.tire` should be set to. */
export function tireTypeFor(loadout: Loadout): TireType {
  return (TIRE_OPTIONS.find((t) => t.id === loadout.tire) ?? TIRE_OPTIONS[0]!).tire;
}
