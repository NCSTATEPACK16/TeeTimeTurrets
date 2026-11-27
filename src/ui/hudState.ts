import type { ClubType } from "../physics/Ballistics";

/**
 * The DOM-free half of the HUD: sim state in, display values out. Split from the writing half so
 * this runs in Vitest's node environment like everything else, and so the rules below -- which
 * elements are visible, which status message wins -- are asserted rather than eyeballed in a
 * browser.
 *
 * Reads only. Per AGENTS.md, src/ui/** is a pure consumer of sim state.
 */

/** The structural slice of Sim this module needs. Structural so tests need no Rapier world. */
export interface HudSource {
  readonly matchTimeRemaining: number;
  readonly cart: {
    readonly equippedClub: ClubType;
    readonly charge: number;
    readonly canFire: boolean;
    readonly reloadRemaining: number;
    readonly ammo: number;
    readonly dead: boolean;
    readonly respawnTimer: number;
    readonly health: { readonly hp: number; readonly max: number };
    /** Seconds outside the arena zone, and until its next drain (#52). Absent: never outside. */
    readonly outOfZoneS?: number;
    readonly zoneDrainIn?: number;
  };
  /**
   * The scoreboard. Two methods rather than the arrays behind them, because `Match` keeps those
   * private and a HUD has no business holding a writable handle to the score.
   */
  readonly match: {
    teamStrokes(team: number): number;
    pointsFor(index: number): number;
  };
  /**
   * Capture flags A-C (`sim/flags.ts`, Stage 3.5c). Absent, or with no sites, on a ground without
   * them: the HUD then shows no flag row at all.
   */
  readonly captures?: {
    readonly sites: { readonly length: number };
    readonly owner: ArrayLike<number>;
    readonly contested: ArrayLike<number>;
    progress(i: number): number;
    readonly bleedHolder: number;
    readonly bleedInS: number;
  };
}

/** The most flags a HUD row has chips for. */
export const HUD_FLAG_CHIPS = 3;
const FLAG_LETTERS = ["A", "B", "C"] as const;

/** One capture flag's chip, from the player's side of the field. */
export interface HudFlag {
  /** False for a chip past the ground's flag count: hide it. */
  shown: boolean;
  letter: string;
  /** Who owns it, as the player sees it. */
  owner: "us" | "them" | "none";
  /** How far the capture leans, 0..1, and toward whom. */
  lean01: number;
  leanTo: "us" | "them" | "none";
  contested: boolean;
}

/** The player is always rig 0 and always team 0; see `matchConfig.teamOf`. */
const PLAYER = 0;
const PLAYER_TEAM = 0;
const ENEMY_TEAM = 1;

export interface HudState {
  clubText: string;
  charge01: number;
  status: string;
  healthFraction: number;
  healthText: string;
  ammoText: string;
  timerText: string;
  /** Both sides' strokes, the player's first: `"US 4 — THEM 7"`. */
  teamScoreText: string;
  /** The player's own kills: `"KILLS 3"`. */
  pointsText: string;
  /** The out-of-zone warning, or empty while inside it (or dead). */
  zoneWarning: string;
  /** One chip per capture flag, A to C. Fixed length; `shown` says which are real. */
  flags: HudFlag[];
  /** Who is bleeding strokes to the flags and when the next goes, or empty while nobody is. */
  bleedText: string;
  /** True while the player's side is the one bleeding. */
  bleedingUs: boolean;
}

/** A blank scratch object shaped like HudState, for a caller to hold and repeatedly pass to
 *  deriveHudState as `out`. Field values are placeholders, overwritten on the first call. */
export function createHudStateScratch(): HudState {
  return {
    clubText: "",
    charge01: 0,
    status: "",
    healthFraction: 0,
    healthText: "",
    ammoText: "",
    timerText: "",
    teamScoreText: "",
    pointsText: "",
    zoneWarning: "",
    flags: Array.from({ length: HUD_FLAG_CHIPS }, (_, i) => ({
      shown: false,
      letter: FLAG_LETTERS[i]!,
      owner: "none" as const,
      lean01: 0,
      leanTo: "none" as const,
      contested: false,
    })),
    bleedText: "",
    bleedingUs: false,
  };
}

/** Writes into `out` rather than allocating a new object -- this runs every frame from main.ts's
 *  render callback, and the project's Global Constraints ban per-frame allocation in the render
 *  loop (see main.ts's scratchA/scratchB/scratchOut for the same pattern). Callers hold one
 *  reusable HudState-shaped scratch object and pass it in. */
export function deriveHudState(source: HudSource, out: HudState): void {
  const cart = source.cart;

  out.clubText = cart.equippedClub.toUpperCase();
  out.charge01 = clamp01(cart.charge);
  out.status = statusText(source);
  out.healthFraction = cart.health.max > 0 ? clamp01(cart.health.hp / cart.health.max) : 0;
  out.healthText = `${Math.max(0, Math.round(cart.health.hp))}`;
  out.ammoText = `${Math.max(0, Math.round(cart.ammo))}`;
  out.timerText = formatClock(source.matchTimeRemaining);
  out.teamScoreText = `US ${source.match.teamStrokes(PLAYER_TEAM)} — THEM ${source.match.teamStrokes(ENEMY_TEAM)}`;
  out.pointsText = `KILLS ${source.match.pointsFor(PLAYER)}`;
  out.zoneWarning = zoneWarningText(source);
  deriveFlags(source, out);
}

/**
 * The flag row, seen from team 0, which is the player's. `progress` runs -1 (team 0's) to +1
 * (team 1's), so the player's lean is its negative.
 */
function deriveFlags(source: HudSource, out: HudState): void {
  const captures = source.captures;
  const count = captures === undefined ? 0 : Math.min(captures.sites.length, HUD_FLAG_CHIPS);
  for (let i = 0; i < HUD_FLAG_CHIPS; i++) {
    const chip = out.flags[i]!;
    chip.shown = i < count;
    if (!chip.shown || captures === undefined) continue;
    const owner = captures.owner[i]!;
    chip.owner = owner === PLAYER_TEAM ? "us" : owner === ENEMY_TEAM ? "them" : "none";
    const lean = -captures.progress(i);
    chip.lean01 = clamp01(Math.abs(lean));
    chip.leanTo = lean > 0 ? "us" : lean < 0 ? "them" : "none";
    chip.contested = captures.contested[i] === 1;
  }

  const holder = captures === undefined ? -1 : captures.bleedHolder;
  out.bleedingUs = holder === ENEMY_TEAM;
  if (captures === undefined || (holder !== PLAYER_TEAM && holder !== ENEMY_TEAM)) {
    out.bleedText = "";
    return;
  }
  const next = Math.max(0, Math.ceil(captures.bleedInS));
  out.bleedText = holder === ENEMY_TEAM ? `WE BLEED −1 IN ${next}s` : `THEY BLEED −1 IN ${next}s`;
}

/**
 * Shown from the first tick outside the zone, before any health goes: the warning is the point.
 * The countdown is to the next lost point of health, which `world.ts` drains every 2 s out there.
 */
function zoneWarningText(source: HudSource): string {
  const cart = source.cart;
  if (cart.dead || !((cart.outOfZoneS ?? 0) > 0)) return "";
  const next = Math.max(0, Math.ceil((cart.zoneDrainIn ?? 0) * 10) / 10).toFixed(1);
  return `OUT OF BOUNDS — GET BACK INSIDE THE STAKES · −1 HP in ${next}s`;
}

/**
 * One line, one message, most urgent first. Death outranks reloading because stepRespawn freezes
 * the reload timer along with everything else -- reporting a reload that is not counting down
 * would be a lie.
 *
 * The death case lives here rather than in a banner on purpose: UI-SPEC H12 (the event banner) is
 * Phase 4's, screen-anchored and longer-dwell, and a bespoke death banner now would either be
 * thrown away or pre-empt that layout. But stepRespawn ignores every intent for RESPAWN_DELAY_S,
 * so with no message at all the game simply appears to freeze. That is a playability hole, not
 * missing polish, and this line is the cheapest honest fix.
 */
function statusText(source: HudSource): string {
  const cart = source.cart;
  if (cart.dead) return `DESTROYED — RESPAWNING ${(Math.floor(cart.respawnTimer * 10) / 10).toFixed(1)}s`;
  if (!cart.canFire) return `RELOADING ${(Math.floor(cart.reloadRemaining * 10) / 10).toFixed(1)}s`;
  return cart.ammo > 0 ? "READY" : "NO AMMO — fire a blank to boost";
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** m:ss, floored -- a clock that rounds up shows 3:00 for a match that has already started. */
function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}
