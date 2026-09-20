/**
 * The event banner (UI-SPEC H12, image 08): the full-width headline + consequence that flashes on
 * a match event -- `WATER HAZARD` / `PLUS ONE STROKE`, `ENEMY DOWN`, `DESTROYED`.
 *
 * This is the whole rulebook for it, and it is DOM-free so the rules -- which event wins a tick,
 * how long a banner dwells, how it fades -- are asserted in the node suite rather than eyeballed in
 * a browser. `banner.ts` is the thin half that writes the result to an element.
 *
 * It is a **separate component from a hit marker** on purpose (UI-SPEC): a hit marker is a one-shot
 * node that animates itself at a world-projected point and is thrown away; a banner is
 * screen-anchored, shows one at a time, and dwells. Reusing one for the other is the obvious wrong
 * turn.
 *
 * Unlike `hudState`/`plateState`, which are pure per-frame functions, this carries state: an event
 * is an *edge* (the tick a flag becomes true), and a banner outlives the edge that fired it. So it
 * is a small class that remembers the last edge and counts the dwell down -- still no DOM, still
 * node-tested. Per AGENTS.md, `src/ui/**` only consumes sim state; nothing here writes back.
 */

/** The structural slice of `Sim` this needs. Structural so a test needs no Rapier world. */
export interface BannerSource {
  readonly holedOut: boolean;
  readonly lastShotInWater: boolean;
  readonly lastShotOutOfBounds: boolean;
  /** The player cart is destroyed and respawning. */
  readonly playerDead: boolean;
  /** The player's kill count (arena `match.pointsFor(0)`); 0 and unchanging in stroke play, so the
   *  kill banner simply never fires there. */
  readonly playerKills: number;
}

export interface BannerView {
  visible: boolean;
  headline: string;
  consequence: string;
  /** 1 while dwelling, ramping to 0 across `BANNER_FADE_S`. */
  opacity: number;
}

/** Seconds a banner holds at full before it begins to fade. */
export const BANNER_DWELL_S = 1.4;
/** Seconds the fade-out takes after the dwell. */
export const BANNER_FADE_S = 0.6;

interface BannerDef {
  readonly headline: string;
  readonly consequence: string;
}

// Ordered low-to-high priority in `update`; the highest-priority edge in a tick wins.
const OUT_OF_BOUNDS: BannerDef = { headline: "OUT OF BOUNDS", consequence: "BACK TO THE TEE" };
const WATER_HAZARD: BannerDef = { headline: "WATER HAZARD", consequence: "PLUS ONE STROKE" };
const ENEMY_DOWN: BannerDef = { headline: "ENEMY DOWN", consequence: "" };
const DESTROYED: BannerDef = { headline: "DESTROYED", consequence: "RESPAWNING" };
const HOLED_OUT: BannerDef = { headline: "HOLED OUT", consequence: "" };

export function createBannerView(): BannerView {
  return { visible: false, headline: "", consequence: "", opacity: 0 };
}

export class BannerFeed {
  private headline = "";
  private consequence = "";
  /** Seconds until the banner is fully gone (dwell + fade). */
  private remaining = 0;

  private prevHoledOut = false;
  private prevWater = false;
  private prevOob = false;
  private prevDead = false;
  private prevKills = 0;
  private baselined = false;

  /**
   * Advance one frame. `dtSeconds` is real elapsed time, so the dwell reads the same at any frame
   * rate. Fires a banner on the rising edge of an event; otherwise counts the current one down.
   */
  update(source: BannerSource, dtSeconds: number): void {
    // First call captures the current flags without firing, so wiring the feed up mid-match does
    // not replay an event that already happened (a non-zero kill count, a cart already dead).
    if (!this.baselined) {
      this.prevHoledOut = source.holedOut;
      this.prevWater = source.lastShotInWater;
      this.prevOob = source.lastShotOutOfBounds;
      this.prevDead = source.playerDead;
      this.prevKills = source.playerKills;
      this.baselined = true;
    }

    let fired: BannerDef | null = null;
    if (source.lastShotOutOfBounds && !this.prevOob) fired = OUT_OF_BOUNDS;
    if (source.lastShotInWater && !this.prevWater) fired = WATER_HAZARD;
    if (source.playerKills > this.prevKills) fired = ENEMY_DOWN;
    if (source.playerDead && !this.prevDead) fired = DESTROYED;
    if (source.holedOut && !this.prevHoledOut) fired = HOLED_OUT;

    this.prevHoledOut = source.holedOut;
    this.prevWater = source.lastShotInWater;
    this.prevOob = source.lastShotOutOfBounds;
    this.prevDead = source.playerDead;
    this.prevKills = source.playerKills;

    if (fired !== null) {
      this.headline = fired.headline;
      this.consequence = fired.consequence;
      this.remaining = BANNER_DWELL_S + BANNER_FADE_S;
    } else if (this.remaining > 0) {
      this.remaining = Math.max(0, this.remaining - dtSeconds);
    }
  }

  /** Writes the current banner into `out`, per the no-allocation-in-the-render-loop rule. */
  view(out: BannerView): void {
    out.visible = this.remaining > 0;
    out.headline = this.headline;
    out.consequence = this.consequence;
    out.opacity = this.remaining >= BANNER_FADE_S ? 1 : this.remaining / BANNER_FADE_S;
  }
}
