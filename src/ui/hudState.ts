import { SwingMode } from "../sim/world";
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
  readonly mode: SwingMode;
  readonly strokes: number;
  readonly holedOut: boolean;
  readonly lastShotInWater: boolean;
  readonly lastShotOutOfBounds: boolean;
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
}

export interface HudState {
  modeText: string;
  clubText: string;
  strokesText: string;
  charge01: number;
  status: string;
  /** UI-SPEC H6 and H7. False hides them outright; see the note on the Swing HUD below. */
  combatVisible: boolean;
  healthFraction: number;
  healthText: string;
  ammoText: string;
}

/** A blank scratch object shaped like HudState, for a caller to hold and repeatedly pass to
 *  deriveHudState as `out`. Field values are placeholders, overwritten on the first call. */
export function createHudStateScratch(): HudState {
  return {
    modeText: "",
    clubText: "",
    strokesText: "",
    charge01: 0,
    status: "",
    combatVisible: false,
    healthFraction: 0,
    healthText: "",
    ammoText: "",
  };
}

/** Writes into `out` rather than allocating a new object -- this runs every frame from main.ts's
 *  render callback, and the project's Global Constraints ban per-frame allocation in the render
 *  loop (see main.ts's scratchA/scratchB/scratchOut for the same pattern). Callers hold one
 *  reusable HudState-shaped scratch object and pass it in. */
export function deriveHudState(source: HudSource, out: HudState): void {
  const cart = source.cart;
  const inCart = source.mode === SwingMode.Cart;

  out.modeText = inCart ? "CART" : "STANDING";
  out.clubText = cart.equippedClub.toUpperCase();
  out.strokesText = `STROKES ${source.strokes}`;
  out.charge01 = clamp01(cart.charge);
  out.status = statusText(source, inCart);
  // UI-SPEC.md section 1's table gives Health and Reload to the Cart HUD and marks them absent
  // from the Swing HUD, and that split maps onto SwingMode. Section 5 scopes the same rule to
  // STROKE vs CTF/TARGETS, a switch that does not exist yet; when it lands these elements gain
  // a second hiding condition rather than a new mechanism.
  out.combatVisible = inCart;
  out.healthFraction = cart.health.max > 0 ? clamp01(cart.health.hp / cart.health.max) : 0;
  out.healthText = `${Math.max(0, Math.round(cart.health.hp))}`;
  out.ammoText = `${Math.max(0, Math.round(cart.ammo))}`;
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
function statusText(source: HudSource, inCart: boolean): string {
  const cart = source.cart;
  if (source.holedOut) return "HOLED OUT — R to reset";
  if (cart.dead) return `DESTROYED — RESPAWNING ${(Math.floor(cart.respawnTimer * 10) / 10).toFixed(1)}s`;
  if (!cart.canFire) return `RELOADING ${(Math.floor(cart.reloadRemaining * 10) / 10).toFixed(1)}s`;
  if (source.lastShotInWater) return "WATER HAZARD — plus one stroke";
  if (source.lastShotOutOfBounds) return "OUT OF BOUNDS — returned to the tee";
  if (!inCart) return "READY";
  return cart.ammo > 0 ? "READY" : "NO AMMO — fire a blank to boost";
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
