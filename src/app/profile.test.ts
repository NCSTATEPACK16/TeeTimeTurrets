import { describe, expect, it } from "vitest";
import { createLoadout } from "../sim/loadout";
import { PROFILE_KEY, awardMatch, loadProfile, newProfile, saveProfile } from "./profile";
import type { KeyValueStore } from "./settings";

function memory(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe("profile", () => {
  it("starts a new player at level 1 with no coins, owning only the free items", () => {
    const p = newProfile();
    expect(p.coins).toBe(0);
    expect(p.level).toBe(1);
    expect(p.xp).toBe(0);
    expect(p.loadout).toEqual(createLoadout());
    expect(p.owned).toContain(createLoadout().paint);
    expect(p.upgrades).toEqual({ armor: 0, ammo: 0, reload: 0 });
  });

  it("round-trips through storage", () => {
    const store = memory();
    const p = { ...newProfile(), coins: 1234, level: 3, xp: 40, owned: [...newProfile().owned, "red"], upgrades: { armor: 1, ammo: 0, reload: 2 } };
    expect(saveProfile(store, p)).toBe(true);
    expect(loadProfile(store)).toEqual(p);
  });

  it("keeps what is still good in a damaged save and drops the rest", () => {
    const store = memory();
    store.setItem(PROFILE_KEY, JSON.stringify({ version: 1, coins: -5, level: 4, xp: "lots", owned: ["red", 7], upgrades: { armor: 9, ammo: 1 }, loadout: { paint: "nope", skin: 3 } }));
    const p = loadProfile(store);
    expect(p.coins).toBe(0);
    expect(p.level).toBe(4);
    expect(p.xp).toBe(0);
    expect(p.owned).toContain("red");
    expect(p.owned).not.toContain(7);
    expect(p.upgrades).toEqual({ armor: 0, ammo: 1, reload: 0 });
    expect(p.loadout).toEqual(createLoadout());
  });

  it("ignores a save from another version, and survives storage that throws", () => {
    const store = memory();
    store.setItem(PROFILE_KEY, JSON.stringify({ version: 99, coins: 500 }));
    expect(loadProfile(store).coins).toBe(0);
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(loadProfile(broken)).toEqual(newProfile());
    expect(saveProfile(broken, newProfile())).toBe(false);
    expect(loadProfile(null)).toEqual(newProfile());
  });

  it("pays a match into the profile: coins, XP and any levels it earns", () => {
    const p = newProfile();
    const { profile, reward } = awardMatch(p, { kills: 3, assists: 1, damage: 12, pickups: 2, won: true });
    expect(reward.score).toBe(300 + 40 + 120 + 30 + 250);
    expect(reward.coins).toBe(370);
    expect(profile.coins).toBe(370);
    expect(reward.levelsGained).toBe(0);
    expect(profile.xp).toBe(740);
    const next = awardMatch(profile, { kills: 0, assists: 0, damage: 1, pickups: 0, won: false });
    expect(next.profile.level).toBe(2);
    expect(next.reward.levelsGained).toBe(1);
    expect(p.coins).toBe(0);
  });
});
