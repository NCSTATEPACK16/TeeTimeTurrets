import { describe, expect, it } from "vitest";
import { CLUB_STATS, ClubType } from "../physics/Ballistics";
import { Cart, MAX_AMMO, TireType } from "./entities/Cart";
import { ARENA_MAX_HEALTH } from "./matchConfig";
import { createLoadout } from "./loadout";
import { DEFAULT_KIT, applyLoadout, kitFor, noUpgrades } from "./upgrades";

/**
 * Stage 8's upgrades smoke check (docs/superpowers/specs/2026-11-28-stage-8-economy-design.md §6):
 * each tier reaches the cart through `applyLoadout`, and the default kit is today's cart.
 */

function kitted(armor: number, ammo: number, reload: number, level: number): Cart {
  const cart = new Cart({ maxHealth: ARENA_MAX_HEALTH });
  applyLoadout(cart, kitFor({ ...createLoadout(), tire: "turf" }, { armor, ammo, reload }, level));
  return cart;
}

/** The reload one iron shot leaves on the cart. */
function reloadAfterShot(cart: Cart): number {
  cart.selectClub(ClubType.Iron);
  expect(cart.fire(1)).toBe(true);
  return cart.reloadRemaining;
}

describe("Stage 8 upgrades", () => {
  it("looks each tier up from the table", () => {
    expect(kitFor(createLoadout(), noUpgrades(), 1)).toEqual({ ...DEFAULT_KIT, driver: false });
    expect(kitFor(createLoadout(), { armor: 2, ammo: 1, reload: 2 }, 2)).toEqual({
      tire: TireType.Street,
      maxHealth: ARENA_MAX_HEALTH + 2,
      maxAmmo: 130,
      reloadScale: 0.8,
      driver: true,
    });
    // A tier past the table, from a hand-edited save, is the top tier, not undefined.
    expect(kitFor(createLoadout(), { armor: 9, ammo: -1, reload: 0 }, 5).maxHealth).toBe(ARENA_MAX_HEALTH + 2);
  });

  it("puts every purchase on the cart, and nothing on a cart with the default kit", () => {
    const plain = new Cart({ maxHealth: ARENA_MAX_HEALTH });
    const defaulted = new Cart({ maxHealth: ARENA_MAX_HEALTH });
    applyLoadout(defaulted, DEFAULT_KIT);
    for (const c of [plain, defaulted]) c.addAmmo(1000);
    expect([defaulted.ammo, defaulted.health.max, defaulted.tire]).toEqual([plain.ammo, plain.health.max, plain.tire]);
    expect(defaulted.ammo).toBe(MAX_AMMO);

    const up = kitted(1, 2, 2, 2);
    expect(up.tire).toBe(TireType.Turf);
    expect([up.health.hp, up.health.max]).toEqual([ARENA_MAX_HEALTH + 1, ARENA_MAX_HEALTH + 1]);
    up.addAmmo(1000);
    expect(up.ammo).toBe(160);

    const base = reloadAfterShot(kitted(0, 0, 0, 2));
    const quick = reloadAfterShot(kitted(0, 0, 2, 2));
    expect(base).toBe(CLUB_STATS[ClubType.Iron].reloadSeconds);
    expect(quick).toBeCloseTo(base * 0.8, 9);
    expect(quick).toBeLessThan(base);
  });

  it("locks the driver below level 2 and frees it from level 2", () => {
    const locked = kitted(0, 0, 0, 1);
    locked.selectClub(ClubType.Driver);
    expect(locked.equippedClub).not.toBe(ClubType.Driver);
    locked.selectClub(ClubType.Iron);
    expect(locked.equippedClub).toBe(ClubType.Iron);

    const free = kitted(0, 0, 0, 2);
    free.selectClub(ClubType.Driver);
    expect(free.equippedClub).toBe(ClubType.Driver);
  });
});
