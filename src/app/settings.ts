/**
 * The player's settings, and the one flag that says the controls card has been shown. Kept in
 * `localStorage`, behind try/catch throughout: a private window, a disabled-storage policy or a
 * full quota all throw, and none of them is a reason for the game not to start.
 *
 * A save is versioned by its key and checked field by field on the way in, so a damaged or older
 * save keeps whatever is still good about it rather than being thrown away whole.
 */

export interface Settings {
  /** 0..1, over everything. */
  master: number;
  /** 0..1, the effects bus. */
  sfx: number;
  /** 0..1, the music bus. */
  music: number;
  muted: boolean;
  /** Mouse-aim multiplier, 0.25..3. */
  sensitivity: number;
}

/** The slice of `Storage` used here, so tests can hand in a map or a store that throws. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  master: 0.8,
  sfx: 0.9,
  music: 0.5,
  muted: false,
  sensitivity: 1,
});

export const SETTINGS_KEY = "teetimeturrets.settings.v1";
const CONTROLS_SEEN_KEY = "teetimeturrets.controlsSeen.v1";

export const SENSITIVITY_MIN = 0.25;
export const SENSITIVITY_MAX = 3;

/** The browser's `localStorage`, or null where even reaching it throws. */
export function browserStore(): KeyValueStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadSettings(store: KeyValueStore | null): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  let saved: unknown = null;
  try {
    const raw = store?.getItem(SETTINGS_KEY) ?? null;
    saved = raw === null ? null : JSON.parse(raw);
  } catch {
    return out;
  }
  if (typeof saved !== "object" || saved === null) return out;
  const s = saved as Record<string, unknown>;
  if (isUnit(s.master)) out.master = s.master;
  if (isUnit(s.sfx)) out.sfx = s.sfx;
  if (isUnit(s.music)) out.music = s.music;
  if (typeof s.muted === "boolean") out.muted = s.muted;
  if (typeof s.sensitivity === "number" && s.sensitivity >= SENSITIVITY_MIN && s.sensitivity <= SENSITIVITY_MAX) {
    out.sensitivity = s.sensitivity;
  }
  return out;
}

/** True if it was written. */
export function saveSettings(store: KeyValueStore | null, settings: Settings): boolean {
  if (store === null) return false;
  try {
    store.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

export function hasSeenControls(store: KeyValueStore | null): boolean {
  try {
    return store?.getItem(CONTROLS_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markControlsSeen(store: KeyValueStore | null): void {
  try {
    store?.setItem(CONTROLS_SEEN_KEY, "1");
  } catch {
    /* Shown again next time. Not worth failing over. */
  }
}

function isUnit(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
}
