/**
 * The DOM-free half of the cart nameplate: sim state in, display values out. Split from
 * `nameplates.ts` for the same reason `hudState.ts` is split from `hud.ts` -- the rules below are
 * the interesting part, and they are asserted in the node suite rather than eyeballed in a browser.
 *
 * UI-SPEC H13. Reads only; per AGENTS.md, src/ui/** is a pure consumer of sim state.
 *
 * Two rules live here, and both are gameplay decisions rather than presentation:
 *
 * 1. **Distance tiers.** Under `EXACT_RANGE_M` the plate reports whole metres, because that is the
 *    range a shot is actually judged at. Out to `COARSE_RANGE_M` it rounds to `COARSE_STEP_M` and
 *    marks the number approximate, so a plate at range stays readable and does not imply a
 *    precision the player has not earned. Past that the number is dropped entirely rather than
 *    frozen at a ceiling: a plate reading the same string for everything beyond 300 m tells you
 *    nothing, and the name alone is the honest answer.
 *
 * 2. **Line of sight.** Allies render through terrain -- you always know where your team is.
 *    Enemies render only while visible, then fade over `ENEMY_FADE_S` into nothing, leaving a
 *    brief last-known trail instead of an instant disappearance. Rendering an enemy plate through
 *    a hill would hand away every flank on a course made of hills, which is the whole reason the
 *    course is worth crossing.
 */

/** Whose plate this is. Allies ignore line of sight; enemies do not. */
export type PlateTeam = "ally" | "enemy";

/** Under this, in metres, the plate reports an exact whole-metre distance. */
export const EXACT_RANGE_M = 100;
/** Out to this the plate reports an approximate distance; past it, no distance at all. */
export const COARSE_RANGE_M = 300;
/** Approximate distances snap to this step. */
export const COARSE_STEP_M = 25;
/** Seconds an enemy plate lingers, fading, after line of sight breaks. */
export const ENEMY_FADE_S = 1;

/** The structural slice of a tracked cart this module needs. Structural so tests need no Rapier. */
export interface PlateSource {
  readonly team: PlateTeam;
  /** Flat distance from the viewing player, in metres. */
  readonly distanceM: number;
  readonly healthFraction: number;
  /** False when the cart is behind the camera or outside the frustum. */
  readonly onScreen: boolean;
  /** Whether the viewing player can currently see this cart. Allies ignore this. */
  readonly hasLineOfSight: boolean;
  /** Seconds since line of sight was last held. Zero while `hasLineOfSight` is true. */
  readonly secondsSinceLastSeen: number;
}

export interface PlateState {
  /** `"87 m"`, `"~175 m"`, or `""` past `COARSE_RANGE_M`. */
  distanceText: string;
  healthFraction: number;
  visible: boolean;
  /** 1 for allies and for enemies in sight; ramps to 0 across `ENEMY_FADE_S` once sight breaks. */
  opacity: number;
  team: PlateTeam;
}

/** A blank scratch object shaped like PlateState, for a caller to hold and pass repeatedly as
 *  `out`. Field values are placeholders, overwritten on the first call. */
export function createPlateStateScratch(): PlateState {
  return { distanceText: "", healthFraction: 0, visible: false, opacity: 0, team: "ally" };
}

/** Writes into `out` rather than allocating -- this runs per cart per frame at 60fps, and the
 *  project's Global Constraints ban per-frame allocation in the render loop. */
export function derivePlateState(source: PlateSource, out: PlateState): void {
  out.team = source.team;
  out.healthFraction = clamp01(source.healthFraction);
  out.distanceText = formatPlateDistance(source.distanceM);

  // Off screen hides outright rather than parking the plate at an edge, matching the rule
  // `Nameplates.setPlate` already documents. The pin marker clamps instead; a plate must not,
  // or a ring of plates piles up on the screen border.
  if (!source.onScreen) {
    out.visible = false;
    out.opacity = 0;
    return;
  }

  out.opacity = source.team === "ally" ? 1 : enemyOpacity(source);
  out.visible = out.opacity > 0;
}

/** Full while in sight, then a linear ramp to nothing across `ENEMY_FADE_S`. */
function enemyOpacity(source: PlateSource): number {
  if (source.hasLineOfSight) return 1;
  if (ENEMY_FADE_S <= 0) return 0;
  return clamp01(1 - source.secondsSinceLastSeen / ENEMY_FADE_S);
}

/** Whole metres up close, approximate at range, nothing past `COARSE_RANGE_M`. */
export function formatPlateDistance(distanceM: number): string {
  const d = Math.max(0, distanceM);
  if (d < EXACT_RANGE_M) return `${Math.round(d)} m`;
  if (d > COARSE_RANGE_M) return "";
  return `~${Math.round(d / COARSE_STEP_M) * COARSE_STEP_M} m`;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
