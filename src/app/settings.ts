import { QUALITY_CHOICES } from "../render/quality";
import type { QualityChoice } from "../render/quality";

/**
 * The player's settings: volumes, mute, mouse sensitivity, graphics quality, and whether the
 * controls card has been shown. Kept in localStorage, which is a convenience and not a guarantee:
 * private browsing, blocked site data or a full quota can make every read and write throw, so both
 * are wrapped and a failure falls back to the defaults. Nothing here may stop the game from starting.
 *
 * A stored blob is schema-guarded field by field. A number out of range is clamped, a field of the
 * wrong type falls back to its default, and a blob from an unknown `version` is ignored whole.
 *
 * **Versions.** 2 added `quality`. A version-1 save is read field by field as before and gets the
 * automatic quality, so a returning player keeps their volumes and is not shown the controls card
 * again.
 */

export interface Settings {
  master: number;
  sfx: number;
  music: number;
  muted: boolean;
  /** Multiplier on mouse aim speed. */
  sensitivity: number;
  /** The first-play controls card has been dismissed. */
  seenControls: boolean;
  /** Graphics preset, or "auto" for whatever suits the device (`render/quality.ts`). */
  quality: QualityChoice;
}

export const SETTINGS_KEY = "teetimeturrets.settings";
const VERSION = 2;
/** Versions this build can read. Everything they share is read the same way. */
const READABLE_VERSIONS: readonly unknown[] = [1, VERSION];

export const SENSITIVITY_MIN = 0.25;
export const SENSITIVITY_MAX = 3;

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  master: 0.8,
  sfx: 1,
  music: 0.5,
  muted: false,
  sensitivity: 1,
  seenControls: false,
  quality: "auto",
};

type Store = Pick<Storage, "getItem" | "setItem">;

export function loadSettings(storage: Store | null): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (!storage) return out;
  let raw: unknown;
  try {
    const text = storage.getItem(SETTINGS_KEY);
    if (text === null) return out;
    raw = JSON.parse(text);
  } catch {
    return out;
  }
  if (typeof raw !== "object" || raw === null) return out;
  const r = raw as Record<string, unknown>;
  if (!READABLE_VERSIONS.includes(r.version)) return out;
  out.master = num(r.master, out.master, 0, 1);
  out.sfx = num(r.sfx, out.sfx, 0, 1);
  out.music = num(r.music, out.music, 0, 1);
  out.sensitivity = num(r.sensitivity, out.sensitivity, SENSITIVITY_MIN, SENSITIVITY_MAX);
  if (typeof r.muted === "boolean") out.muted = r.muted;
  if (typeof r.seenControls === "boolean") out.seenControls = r.seenControls;
  if (QUALITY_CHOICES.includes(r.quality as QualityChoice)) out.quality = r.quality as QualityChoice;
  return out;
}

export function saveSettings(storage: Store | null, settings: Settings): void {
  if (!storage) return;
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify({ version: VERSION, ...settings }));
  } catch {
    // Not saved; the settings still apply for this visit.
  }
}

/** The page's storage, or null where even touching `localStorage` throws. */
export function pageStorage(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}
