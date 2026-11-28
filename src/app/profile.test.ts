import { describe, expect, it } from "vitest";
import { PROFILE_KEY, coinGrantFromQuery, creditMatch, loadProfile, newProfile, saveProfile } from "./profile";
import type { Profile } from "./profile";
import { ClubhouseState } from "../ui/screens/clubhouseState";
import { createEarnings } from "../sim/scoring";

/**
 * Stage 8's profile smoke check (docs/superpowers/specs/2026-11-28-stage-8-economy-design.md §6):
 * it survives a save, it refuses what it cannot trust, and a purchase stays bought.
 */

function memoryStore(): Pick<Storage, "getItem" | "setItem"> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

/** One clubhouse visit: build from the saved profile, act, save what it hands back. */
function visit(store: ReturnType<typeof memoryStore>, act: (s: ClubhouseState) => void): Profile {
  const state = new ClubhouseState(loadProfile(store));
  act(state);
  saveProfile(store, state.profile);
  return state.profile;
}

describe("the profile", () => {
  it("starts empty, and round-trips through storage", () => {
    const store = memoryStore();
    expect(loadProfile(store)).toEqual(newProfile());
    expect(newProfile().coins).toBe(0);

    const p: Profile = {
      coins: 1234,
      xp: 40,
      level: 3,
      owned: ["sunset", "chrome"],
      loadout: { paint: "sunset", skin: "chrome", tire: "street" },
      upgrades: { armor: 1, ammo: 2, reload: 0 },
    };
    saveProfile(store, p);
    expect(loadProfile(store)).toEqual(p);
  });

  it("falls back on a corrupt blob, an unknown version, and field by field on bad fields", () => {
    const store = memoryStore();
    store.setItem(PROFILE_KEY, "{not json");
    expect(loadProfile(store)).toEqual(newProfile());
    store.setItem(PROFILE_KEY, JSON.stringify({ version: 99, coins: 5000 }));
    expect(loadProfile(store).coins).toBe(0);

    store.setItem(
      PROFILE_KEY,
      JSON.stringify({
        version: 1,
        coins: "lots",
        level: 4,
        owned: ["fairway", "no-such-paint", 7],
        // Equipped but never bought, and a paint that does not exist.
        loadout: { paint: "marshal", skin: "chrome", tire: "turf" },
        upgrades: { armor: 9, ammo: -3 },
      }),
    );
    const p = loadProfile(store);
    expect(p.coins).toBe(0);
    expect(p.level).toBe(4);
    expect(p.owned).toEqual(["fairway"]);
    expect(p.loadout).toEqual(newProfile().loadout);
    expect(p.upgrades).toEqual({ armor: 2, ammo: 0, reload: 0 });
  });

  it("keeps everything bought across clubhouse visits", () => {
    const store = memoryStore();
    saveProfile(store, { ...newProfile(), coins: 5000 });

    visit(store, (s) => {
      s.select("paint", "sunset");
      expect(s.confirm()).toBe(true);
    });
    visit(store, (s) => {
      s.select("paint", "fairway");
      expect(s.confirm()).toBe(true);
      expect(s.buyUpgrade("ammo")).toBe(true);
    });
    const third = visit(store, (s) => {
      // Back to the first paint: owned, so it costs nothing. The bug charged for it again.
      expect(s.owns("sunset")).toBe(true);
      s.select("paint", "sunset");
      expect(s.pendingCost).toBe(0);
      expect(s.confirm()).toBe(true);
    });
    expect(third.coins).toBe(5000 - 900 - 900 - 800);
    expect(third.loadout.paint).toBe("sunset");
    expect([...third.owned].sort()).toEqual(["fairway", "sunset"]);
    expect(third.upgrades.ammo).toBe(1);
  });

  it("credits a match's coins and XP, and reads the play-tester's coin grant", () => {
    const earned = { ...createEarnings(), coins: 300, xp: 800 };
    expect(creditMatch(newProfile(), earned)).toMatchObject({ coins: 300, level: 2, xp: 50 });
    expect(coinGrantFromQuery("?match=60&coins=5000")).toBe(5000);
    expect(coinGrantFromQuery("?coins=-5")).toBe(0);
    expect(coinGrantFromQuery("?coins=1e9")).toBe(0);
    expect(coinGrantFromQuery("")).toBe(0);
  });
});
