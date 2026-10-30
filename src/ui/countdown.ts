/**
 * The pre-match "TEE TIME · 3 · 2 · 1 · FORE!" callout, driven by `Match.countdownRemaining`.
 *
 * Split like `bannerFeed.ts`/`banner.ts`: `countdownBeat` decides what to show and is node-tested;
 * `CountdownDisplay` only writes it to `#countdown` and restarts the punch animation when the beat
 * changes. Nothing here writes back to the sim.
 */

/** Seconds FORE! stays up after the match goes live. */
export const FORE_HOLD_S = 0.9;

export interface CountdownBeat {
  /** What to show; empty when nothing is. */
  label: string;
  /**
   * Changes exactly when the label does, so a caller can fire one sound per beat. 0 is nothing,
   * 1 the lead-in, 2..4 the numbers 3, 2, 1, and 5 FORE!.
   */
  beat: number;
}

/**
 * The beat for a countdown with `remaining` seconds left, or for `sinceLive` seconds after it
 * ended. Any countdown longer than three seconds opens with TEE TIME for the extra time.
 */
export function countdownBeat(remaining: number, sinceLive: number, out: CountdownBeat): CountdownBeat {
  if (remaining > 0) {
    const n = Math.ceil(remaining);
    if (n > 3) {
      out.label = "TEE TIME";
      out.beat = 1;
    } else {
      out.label = String(n);
      out.beat = 5 - n;
    }
  } else if (sinceLive < FORE_HOLD_S) {
    out.label = "FORE!";
    out.beat = 5;
  } else {
    out.label = "";
    out.beat = 0;
  }
  return out;
}

/** The DOM half. A missing `#countdown` makes every call a no-op. */
export class CountdownDisplay {
  private shown = -1;

  constructor(private readonly root: HTMLElement | null) {}

  /** Writes the beat; returns true on the frame it changed, so the caller can play its cue. */
  draw(beat: CountdownBeat): boolean {
    if (beat.beat === this.shown) return false;
    this.shown = beat.beat;
    const root = this.root;
    if (!root) return true;
    root.hidden = beat.beat === 0;
    root.textContent = beat.label;
    root.classList.toggle("fore", beat.beat === 5);
    // Restart the punch: drop the class, force a style flush, put it back.
    root.classList.remove("punch");
    void root.offsetWidth;
    root.classList.add("punch");
    return true;
  }

  hide(): void {
    this.shown = 0;
    if (this.root) this.root.hidden = true;
  }
}
