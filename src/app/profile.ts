import { CHASSIS_PAINTS, TIRE_OPTIONS, TURRET_SKINS, createLoadout } from "../sim/loadout";
import type { Loadout } from "../sim/loadout";
import { UPGRADES, noUpgrades } from "../sim/upgrades";
import type { UpgradeTiers } from "../sim/upgrades";
import { addXp } from "../sim/scoring";
import type { Earnings } from "../sim/scoring";

/**
 * The player's progress: coins, level and XP, what they own, what they have equipped and which
 * upgrade tiers they hold (Stage 8, docs/superpowers/specs/2026-11-28-stage-8-economy-design.md
 * §3). Kept in localStorage like `settings.ts`, with the same caveat: storage can throw or be
 * absent, so every read and write is wrapped, and a failure leaves a working profile for the visit.
 *
 * **Schema-guarded, field by field.** A missing or wrongly typed field takes its default. An owned
 * id that names no option is dropped, an equipped option that is not owned falls back to the free
 * one, and an upgrade tier is clamped to the table. A blob from an unknown version, or one that is
 * not JSON, is ignored whole.
 */

export interface Profile {
  coins: number;
  /** XP into the current level. */
  xp: number;
  /** From 1. */
  level: number;
  /** Ids of the cosmetic and tyre options bought. The free ones are always owned and not listed. */
  owned: string[];
  loadout: Loadout;
  upgrades: UpgradeTiers;
}

export const PROFILE_KEY = "teetimeturrets.profile";
const VERSION = 1;

type Store = Pick<Storage, "getItem" | "setItem">;

/** A new player: nothing bought, nothing earned, level 1, 0 coins. */
export function newProfile(): Profile {
  return { coins: 0, xp: 0, level: 1, owned: [], loadout: createLoadout(), upgrades: noUpgrades() };
}

const ALL_OPTIONS = [...CHASSIS_PAINTS, ...TURRET_SKINS, ...TIRE_OPTIONS];

/** Owned outright, or free. */
export function ownsOption(profile: Profile, id: string): boolean {
  return profile.owned.includes(id) || ALL_OPTIONS.some((o) => o.id === id && o.price === 0);
}

export function loadProfile(storage: Store | null): Profile {
  const out = newProfile();
  if (!storage) return out;
  let raw: unknown;
  try {
    const text = storage.getItem(PROFILE_KEY);
    if (text === null) return out;
    raw = JSON.parse(text);
  } catch {
    return out;
  }
  if (typeof raw !== "object" || raw === null) return out;
  const r = raw as Record<string, unknown>;
  if (r.version !== VERSION) return out;

  out.coins = whole(r.coins, 0);
  out.xp = whole(r.xp, 0);
  out.level = Math.max(1, whole(r.level, 1));
  if (Array.isArray(r.owned)) {
    const known = new Set(ALL_OPTIONS.filter((o) => o.price > 0).map((o) => o.id));
    out.owned = [...new Set(r.owned.filter((id): id is string => typeof id === "string" && known.has(id)))];
  }
  if (typeof r.loadout === "object" && r.loadout !== null) {
    const l = r.loadout as Record<string, unknown>;
    const pick = (value: unknown, list: readonly { id: string }[], fallback: string): string =>
      typeof value === "string" && list.some((o) => o.id === value) && ownsOption(out, value) ? value : fallback;
    out.loadout = {
      paint: pick(l.paint, CHASSIS_PAINTS, out.loadout.paint),
      skin: pick(l.skin, TURRET_SKINS, out.loadout.skin),
      tire: pick(l.tire, TIRE_OPTIONS, out.loadout.tire),
    };
  }
  if (typeof r.upgrades === "object" && r.upgrades !== null) {
    const u = r.upgrades as Record<string, unknown>;
    for (const upgrade of UPGRADES) {
      out.upgrades[upgrade.id] = Math.min(upgrade.tiers.length, whole(u[upgrade.id], 0));
    }
  }
  return out;
}

export function saveProfile(storage: Store | null, profile: Profile): void {
  if (!storage) return;
  try {
    storage.setItem(PROFILE_KEY, JSON.stringify({ version: VERSION, ...profile }));
  } catch {
    // Not saved; the profile still holds for this visit.
  }
}

/** A finished match's coins and XP, onto a copy of the profile. */
export function creditMatch(profile: Profile, earnings: Earnings): Profile {
  const next = addXp(profile.level, profile.xp, earnings.xp);
  return { ...profile, coins: profile.coins + earnings.coins, level: next.level, xp: next.xp };
}

/**
 * `?coins=N`: a play-tester's grant, so the shop can be tried without grinding matches (Q3). Read
 * once on load by `main.ts`. Whole and non-negative, capped at a million; anything else is no grant.
 */
export function coinGrantFromQuery(search: string): number {
  const raw = new URLSearchParams(search).get("coins");
  if (raw === null || !/^\d+$/.test(raw)) return 0;
  return Math.min(1_000_000, Number(raw));
}

function whole(v: unknown, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.max(0, Math.floor(v));
}
