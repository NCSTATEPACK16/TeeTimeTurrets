import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, SETTINGS_KEY, loadSettings, saveSettings } from "./settings";

/** A storage that holds strings in a map, and one that throws on every call (private mode). */
function memoryStorage(initial: Record<string, string> = {}): Pick<Storage, "getItem" | "setItem"> {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}
const throwingStorage: Pick<Storage, "getItem" | "setItem"> = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

describe("settings", () => {
  it("round-trips through storage", () => {
    const storage = memoryStorage();
    const s = { ...DEFAULT_SETTINGS, master: 0.3, muted: true, sensitivity: 1.8, seenControls: true };
    saveSettings(storage, s);
    expect(loadSettings(storage)).toEqual(s);
  });

  it("falls back to the defaults with nothing stored, garbage stored, or no storage at all", () => {
    expect(loadSettings(memoryStorage())).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(memoryStorage({ [SETTINGS_KEY]: "{not json" }))).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(throwingStorage)).toEqual(DEFAULT_SETTINGS);
  });

  it("never throws when storage refuses a write", () => {
    expect(() => saveSettings(throwingStorage, DEFAULT_SETTINGS)).not.toThrow();
  });

  it("clamps out-of-range numbers and drops fields of the wrong type, keeping the good ones", () => {
    const storage = memoryStorage({
      [SETTINGS_KEY]: JSON.stringify({ version: 1, master: 7, sfx: -2, music: "loud", muted: "yes", sensitivity: 0.2 }),
    });
    const s = loadSettings(storage);
    expect(s.master).toBe(1);
    expect(s.sfx).toBe(0);
    expect(s.music).toBe(DEFAULT_SETTINGS.music);
    expect(s.muted).toBe(DEFAULT_SETTINGS.muted);
    expect(s.sensitivity).toBe(0.25);
  });

  it("round-trips a quality choice, and reads an unknown one as auto", () => {
    const storage = memoryStorage();
    saveSettings(storage, { ...DEFAULT_SETTINGS, quality: "high" });
    expect(loadSettings(storage).quality).toBe("high");
    const bad = memoryStorage({ [SETTINGS_KEY]: JSON.stringify({ version: 2, quality: "ultra" }) });
    expect(loadSettings(bad).quality).toBe("auto");
    expect(DEFAULT_SETTINGS.quality).toBe("auto");
  });

  /**
   * Version 1 had no `quality`. A player's save from before it must keep every setting it held --
   * the volumes, the sensitivity and, above all, `seenControls`, or every returning player is shown
   * the controls card again -- and simply get the automatic quality.
   */
  it("keeps everything in a version-1 save, and gives it the automatic quality", () => {
    const v1 = { version: 1, master: 0.3, sfx: 0.4, music: 0.2, muted: true, sensitivity: 2, seenControls: true };
    const loaded = loadSettings(memoryStorage({ [SETTINGS_KEY]: JSON.stringify(v1) }));
    expect(loaded).toEqual({ master: 0.3, sfx: 0.4, music: 0.2, muted: true, sensitivity: 2, seenControls: true, quality: "auto" });
  });

  it("writes the current version", () => {
    const storage = memoryStorage();
    saveSettings(storage, DEFAULT_SETTINGS);
    expect(JSON.parse(storage.getItem(SETTINGS_KEY)!).version).toBe(2);
  });

  it("ignores a save from a different version rather than misreading it", () => {
    const storage = memoryStorage({ [SETTINGS_KEY]: JSON.stringify({ version: 99, master: 0.1 }) });
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });
});
