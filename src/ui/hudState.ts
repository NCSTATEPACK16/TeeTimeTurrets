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
  };
  /**
   * The scoreboard. Two methods rather than the arrays behind them, because `Match` keeps those
   * private and a HUD has no business holding a writable handle to the score.
   */
  readonly match: {
    teamStrokes(team: number): number;
    pointsFor(index: number): number;
  };
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
  /** How far the low-health vignette closes in, 0..1. */
  vignette01: number;
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
    vignette01: 0,
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
  out.vignette01 = cart.dead ? 0 : clamp01((LOW_HEALTH_FRACTION - out.healthFraction) / LOW_HEALTH_FRACTION);
}

/**
 * Health fraction below which the screen's edges start to close in. Half, so on an 8 HP cart the
 * warning starts at 3 HP and is strong at 1: two putter hits from dead.
 */
const LOW_HEALTH_FRACTION = 0.5;

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
