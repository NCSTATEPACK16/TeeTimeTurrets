/**
 * The player's progress across matches: coins, level and XP, what they own, what they wear and
 * what they have upgraded. Kept in `localStorage` like the settings (`settings.ts`), behind
 * try/catch throughout, and read field by field so a damaged save keeps what is still good.
 *
 * Versioned by a `version` field as well as the key: a save from another version is not guessed
 * at, and the player starts again rather than being handed a profile read wrong.
 *
 * A new profile has no coins. What it owns is the free items plus whatever it has bought, kept as a
 * list -- the clubhouse used to rebuild ownership from what was equipped, so anything bought and
 * then taken off was lost on the next visit.
 */

import { CHASSIS_PAINTS, TIRE_OPTIONS, TURRET_SKINS, createLoadout } from "../sim/loadout";
import type { Loadout } from "../sim/loadout";
import { addXp, coinsFor, matchScore } from "../sim/scoring";
import type { MatchOutcome } from "../sim/scoring";
import { UPGRADES, createUpgradeLevels } from "../sim/upgrades";
import type { UpgradeLevels } from "../sim/upgrades";
import type { KeyValueStore } from "./settings";

export const PROFILE_KEY = "teetimeturrets.profile";
export const PROFILE_VERSION = 1;

export interface Profile {
  coins: number;
  level: number;
  /** XP into the current level. */
  xp: number;
  /** Ids of every paint, skin and tyre the player owns. */
  owned: string[];
  loadout: Loadout;
  upgrades: UpgradeLevels;
}

export interface MatchReward {
  readonly score: number;
  readonly coins: number;
  readonly xp: number;
  readonly levelsGained: number;
}

const ALL_OPTIONS = [...CHASSIS_PAINTS, ...TURRET_SKINS, ...TIRE_OPTIONS];

export function newProfile(): Profile {
  return {
    coins: 0,
    level: 1,
    xp: 0,
    owned: ALL_OPTIONS.filter((o) => o.price === 0).map((o) => o.id),
    loadout: createLoadout(),
    upgrades: createUpgradeLevels(),
  };
}

export function loadProfile(store: KeyValueStore | null): Profile {
  const out = newProfile();
  let saved: unknown = null;
  try {
    const raw = store?.getItem(PROFILE_KEY) ?? null;
    saved = raw === null ? null : JSON.parse(raw);
  } catch {
    return out;
  }
  if (typeof saved !== "object" || saved === null) return out;
  const s = saved as Record<string, unknown>;
  if (s.version !== PROFILE_VERSION) return out;
  if (isCount(s.coins)) out.coins = s.coins;
  if (isCount(s.level) && s.level >= 1) out.level = s.level;
  if (isCount(s.xp)) out.xp = s.xp;
  if (Array.isArray(s.owned)) {
    for (const id of s.owned) if (typeof id === "string" && !out.owned.includes(id)) out.owned.push(id);
  }
  if (typeof s.loadout === "object" && s.loadout !== null) {
    const l = s.loadout as Record<string, unknown>;
    if (isOption(CHASSIS_PAINTS, l.paint)) out.loadout.paint = l.paint;
    if (isOption(TURRET_SKINS, l.skin)) out.loadout.skin = l.skin;
    if (isOption(TIRE_OPTIONS, l.tire)) out.loadout.tire = l.tire;
  }
  if (typeof s.upgrades === "object" && s.upgrades !== null) {
    const u = s.upgrades as Record<string, unknown>;
    for (const upgrade of UPGRADES) {
      const level = u[upgrade.id];
      if (isCount(level) && level <= upgrade.maxLevel) out.upgrades[upgrade.id] = level;
    }
  }
  return out;
}

/** True if it was written. */
export function saveProfile(store: KeyValueStore | null, profile: Profile): boolean {
  if (store === null) return false;
  try {
    store.setItem(PROFILE_KEY, JSON.stringify({ version: PROFILE_VERSION, ...profile }));
    return true;
  } catch {
    return false;
  }
}

/** The profile after a match paid into it, and what it paid. `profile` itself is not changed. */
export function awardMatch(profile: Profile, outcome: MatchOutcome): { profile: Profile; reward: MatchReward } {
  const score = matchScore(outcome);
  const coins = coinsFor(score);
  const progress = addXp(profile, score);
  return {
    profile: { ...profile, coins: profile.coins + coins, level: progress.level, xp: progress.xp },
    reward: { score, coins, xp: score, levelsGained: progress.levelsGained },
  };
}

function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function isOption(list: readonly { readonly id: string }[], id: unknown): id is string {
  return typeof id === "string" && list.some((o) => o.id === id);
}
