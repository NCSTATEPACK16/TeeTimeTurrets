import { ARENA_MAX_HEALTH } from "./matchConfig";
import { MAX_AMMO, TireType } from "./entities/Cart";
import type { Cart } from "./entities/Cart";
import { tireTypeFor } from "./loadout";
import type { Loadout } from "./loadout";

/**
 * Stage 8's stat upgrades and the one function that applies them
 * (docs/superpowers/specs/2026-11-28-stage-8-economy-design.md §4). DOM-free: the match reads it.
 *
 * Tiers are bought in order. Tier 0 is the cart every player starts with, which is also every
 * bot's cart, so a cart with no upgrades is exactly today's cart.
 */

export type UpgradeId = "armor" | "ammo" | "reload";

export interface UpgradeTier {
  readonly price: number;
  /** The tier's value: max health, ammo capacity, or the reload multiplier. */
  readonly value: number;
  /** For the shop row: what this tier gives. */
  readonly note: string;
}

export interface Upgrade {
  readonly id: UpgradeId;
  readonly label: string;
  /** Tier 0, what a cart has before buying anything. */
  readonly base: number;
  readonly tiers: readonly UpgradeTier[];
}

export const UPGRADES: readonly Upgrade[] = [
  {
    id: "armor",
    label: "ARMOR",
    base: ARENA_MAX_HEALTH,
    tiers: [
      { price: 1500, value: ARENA_MAX_HEALTH + 1, note: `${ARENA_MAX_HEALTH + 1} HP` },
      { price: 3000, value: ARENA_MAX_HEALTH + 2, note: `${ARENA_MAX_HEALTH + 2} HP` },
    ],
  },
  {
    id: "ammo",
    label: "AMMO BAG",
    base: MAX_AMMO,
    tiers: [
      { price: 800, value: 130, note: "130 BALLS" },
      { price: 1600, value: 160, note: "160 BALLS" },
    ],
  },
  {
    id: "reload",
    label: "QUICK RELOAD",
    base: 1,
    tiers: [
      { price: 1200, value: 0.9, note: "RELOAD −10%" },
      { price: 2400, value: 0.8, note: "RELOAD −20%" },
    ],
  },
];

/** The level the driver unlocks at (Q5). */
export const DRIVER_UNLOCK_LEVEL = 2;

export type UpgradeTiers = Record<UpgradeId, number>;

export function noUpgrades(): UpgradeTiers {
  return { armor: 0, ammo: 0, reload: 0 };
}

export function upgradeById(id: UpgradeId): Upgrade {
  return UPGRADES.find((u) => u.id === id)!;
}

/** The value at `tier`, clamped to the table: tier 0 is the base. */
export function upgradeValue(id: UpgradeId, tier: number): number {
  const u = upgradeById(id);
  const t = Math.max(0, Math.min(u.tiers.length, Math.floor(tier)));
  return t === 0 ? u.base : u.tiers[t - 1]!.value;
}

/** What the sim needs to know of a player's purchases: the stats `applyLoadout` writes. */
export interface CartKit {
  readonly tire: TireType;
  readonly maxHealth: number;
  readonly maxAmmo: number;
  /** Multiplies every club's `reloadSeconds`. */
  readonly reloadScale: number;
  /** False below `DRIVER_UNLOCK_LEVEL`: the driver cannot be selected, and the cart starts on the iron. */
  readonly driver: boolean;
}

/** Today's cart: street tyres, no upgrades, the driver unlocked. Every bot's kit. */
export const DEFAULT_KIT: CartKit = {
  tire: TireType.Street,
  maxHealth: ARENA_MAX_HEALTH,
  maxAmmo: MAX_AMMO,
  reloadScale: 1,
  driver: true,
};

/** The pure lookup from what the player owns and has equipped to the kit the match applies. */
export function kitFor(loadout: Loadout, upgrades: UpgradeTiers, level: number): CartKit {
  return {
    tire: tireTypeFor(loadout),
    maxHealth: upgradeValue("armor", upgrades.armor),
    maxAmmo: upgradeValue("ammo", upgrades.ammo),
    reloadScale: upgradeValue("reload", upgrades.reload),
    driver: level >= DRIVER_UNLOCK_LEVEL,
  };
}

/**
 * The only place a purchase becomes a stat. Called once on a cart, when `Sim.create` builds it;
 * `revive` and `rearm` then reset to these values rather than to the constants.
 */
export function applyLoadout(cart: Cart, kit: CartKit): void {
  cart.applyKit(kit.tire, kit.maxHealth, kit.maxAmmo, kit.reloadScale, kit.driver);
}
