import { ClubType } from "../physics/Ballistics";
import { STARTING_AMMO } from "./entities/Cart";
import type { Cart } from "./entities/Cart";
import { tireTypeFor } from "./loadout";
import type { Loadout } from "./loadout";
import { ARENA_MAX_HEALTH } from "./matchConfig";

/**
 * What a player can buy that changes how their cart fights, and the one function that applies it.
 *
 * Cosmetics (`loadout.ts`) change how a cart looks; the tyre is the one cosmetic-shop item that is
 * also a stat. These are the rest: armour, a bigger starting load and a quicker reload, each in
 * three levels, and the driver, which is earned by level rather than bought.
 *
 * `applyLoadout` is the only place a cart's fighting stats are changed from their stock values, so
 * a stat on screen and a stat in the sim cannot come from two places.
 */

export type UpgradeId = "armor" | "ammo" | "reload";
export type UpgradeLevels = Record<UpgradeId, number>;

export interface Upgrade {
  readonly id: UpgradeId;
  readonly label: string;
  readonly note: string;
  readonly maxLevel: number;
  /** Price of the first level; each level after costs this times its number. */
  readonly basePrice: number;
}

export const UPGRADES: readonly Upgrade[] = [
  { id: "armor", label: "ARMOUR", note: "+1 HP a level.", maxLevel: 3, basePrice: 800 },
  { id: "ammo", label: "BALL BAG", note: "+10 balls to start each life with, a level.", maxLevel: 3, basePrice: 600 },
  { id: "reload", label: "QUICK HANDS", note: "Every club reloads 8% faster a level.", maxLevel: 3, basePrice: 900 },
];

export const ARMOR_HP_PER_LEVEL = 1;
export const AMMO_PER_LEVEL = 10;
export const RELOAD_SCALE_PER_LEVEL = 0.92;
/** The player level at which the driver can be selected. */
export const DRIVER_UNLOCK_LEVEL = 2;

export function createUpgradeLevels(): UpgradeLevels {
  return { armor: 0, ammo: 0, reload: 0 };
}

/** Price of the next level from `level`, or Infinity once it is maxed. */
export function upgradePrice(id: UpgradeId, level: number): number {
  const upgrade = UPGRADES.find((u) => u.id === id);
  if (!upgrade || level >= upgrade.maxLevel) return Infinity;
  return upgrade.basePrice * (level + 1);
}

/** Sets a cart up as `loadout`, `upgrades` and the player's `level` say. Refills health and ammo. */
export function applyLoadout(cart: Cart, loadout: Loadout, upgrades: UpgradeLevels, level: number): void {
  cart.tire = tireTypeFor(loadout);
  cart.setMaxHealth(ARENA_MAX_HEALTH + ARMOR_HP_PER_LEVEL * upgrades.armor);
  cart.startingAmmo = STARTING_AMMO + AMMO_PER_LEVEL * upgrades.ammo;
  cart.ammo = cart.startingAmmo;
  cart.reloadScale = Math.pow(RELOAD_SCALE_PER_LEVEL, upgrades.reload);
  cart.lockedClubs.clear();
  if (level < DRIVER_UNLOCK_LEVEL) cart.lockedClubs.add(ClubType.Driver);
}
