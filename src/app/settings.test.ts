import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, SETTINGS_KEY, hasSeenControls, loadSettings, markControlsSeen, saveSettings } from "./settings";
import type { KeyValueStore } from "./settings";

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

const throwingStore: KeyValueStore = {
  getItem: () => {
    throw new Error("SecurityError: storage is disabled");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

describe("settings", () => {
  it("starts from the defaults when nothing is saved", () => {
    expect(loadSettings(memoryStore())).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips what was saved", () => {
    const store = memoryStore();
    const mine = { master: 0.3, sfx: 1, music: 0, muted: true, sensitivity: 1.8, quality: "high" as const };
    expect(saveSettings(store, mine)).toBe(true);
    expect(loadSettings(store)).toEqual(mine);
  });

  it("keeps the good fields of a damaged save and defaults the rest", () => {
    const store = memoryStore({ [SETTINGS_KEY]: JSON.stringify({ master: 0.4, sfx: "loud", music: 7, muted: "yes" }) });
    expect(loadSettings(store)).toEqual({ ...DEFAULT_SETTINGS, master: 0.4 });
  });

  it("lets the device pick the graphics quality until the player does", () => {
    expect(DEFAULT_SETTINGS.quality).toBe("auto");
    const store = memoryStore({ [SETTINGS_KEY]: JSON.stringify({ quality: "low" }) });
    expect(loadSettings(store).quality).toBe("low");
  });

  it("ignores a saved quality it does not know, such as a preset from a later version", () => {
    const store = memoryStore({ [SETTINGS_KEY]: JSON.stringify({ quality: "ultra", master: 0.2 }) });
    expect(loadSettings(store)).toEqual({ ...DEFAULT_SETTINGS, master: 0.2 });
  });

  it("survives a save that is not JSON at all", () => {
    expect(loadSettings(memoryStore({ [SETTINGS_KEY]: "{not json" }))).toEqual(DEFAULT_SETTINGS);
  });

  it("survives storage that throws, as a private window's does", () => {
    expect(loadSettings(throwingStore)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(throwingStore, DEFAULT_SETTINGS)).toBe(false);
    expect(hasSeenControls(throwingStore)).toBe(false);
    expect(() => markControlsSeen(throwingStore)).not.toThrow();
  });

  it("remembers that the controls were shown", () => {
    const store = memoryStore();
    expect(hasSeenControls(store)).toBe(false);
    markControlsSeen(store);
    expect(hasSeenControls(store)).toBe(true);
  });
});
