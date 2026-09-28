import { describe, expect, it } from "vitest";
import { CLUB_STATS, ClubType } from "../physics/Ballistics";
import { Cart, STARTING_AMMO, TireType } from "./entities/Cart";
import { ARENA_MAX_HEALTH } from "./matchConfig";
import { createLoadout } from "./loadout";
import { DRIVER_UNLOCK_LEVEL, UPGRADES, applyLoadout, upgradePrice } from "./upgrades";

describe("UPGRADES", () => {
  it("has armour, ammo, reload and a price for every level", () => {
    expect(UPGRADES.map((u) => u.id).sort()).toEqual(["ammo", "armor", "reload"]);
    for (const u of UPGRADES) {
      for (let level = 0; level < u.maxLevel; level++) expect(upgradePrice(u.id, level)).toBeGreaterThan(0);
      expect(upgradePrice(u.id, u.maxLevel)).toBe(Infinity);
    }
  });
});

describe("applyLoadout", () => {
  const knobby = { ...createLoadout(), tire: "knobby" };

  it("sets the tyre, armour, ammo and reload a cart fights with", () => {
    const cart = new Cart();
    applyLoadout(cart, knobby, { armor: 2, ammo: 1, reload: 3 }, 5);
    expect(cart.tire).toBe(TireType.Knobby);
    expect(cart.health.max).toBe(ARENA_MAX_HEALTH + 2);
    expect(cart.health.hp).toBe(ARENA_MAX_HEALTH + 2);
    expect(cart.startingAmmo).toBeGreaterThan(STARTING_AMMO);
    expect(cart.ammo).toBe(cart.startingAmmo);
    cart.fire(1);
    expect(cart.reloadRemaining).toBeLessThan(CLUB_STATS[ClubType.Putter].reloadSeconds);
  });

  it("leaves a stock cart stock", () => {
    const cart = new Cart();
    applyLoadout(cart, createLoadout(), { armor: 0, ammo: 0, reload: 0 }, 1);
    expect(cart.health.max).toBe(ARENA_MAX_HEALTH);
    expect(cart.startingAmmo).toBe(STARTING_AMMO);
    cart.fire(1);
    expect(cart.reloadRemaining).toBeCloseTo(CLUB_STATS[ClubType.Putter].reloadSeconds, 9);
  });

  it("locks the driver below level 2, and a locked club cannot be selected", () => {
    const rookie = new Cart();
    applyLoadout(rookie, createLoadout(), { armor: 0, ammo: 0, reload: 0 }, DRIVER_UNLOCK_LEVEL - 1);
    rookie.selectClub(ClubType.Driver);
    expect(rookie.equippedClub).toBe(ClubType.Putter);
    rookie.selectClub(ClubType.Iron);
    expect(rookie.equippedClub).toBe(ClubType.Iron);

    const veteran = new Cart();
    applyLoadout(veteran, createLoadout(), { armor: 0, ammo: 0, reload: 0 }, DRIVER_UNLOCK_LEVEL);
    veteran.selectClub(ClubType.Driver);
    expect(veteran.equippedClub).toBe(ClubType.Driver);
  });

  it("keeps the upgraded ammo through a death and a rematch", () => {
    const cart = new Cart();
    applyLoadout(cart, createLoadout(), { armor: 0, ammo: 2, reload: 0 }, 1);
    cart.ammo = 0;
    cart.revive();
    expect(cart.ammo).toBe(cart.startingAmmo);
    cart.ammo = 3;
    cart.rearm();
    expect(cart.ammo).toBe(cart.startingAmmo);
  });
});
