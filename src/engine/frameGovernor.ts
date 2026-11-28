/**
 * The 120/60 governor (Stage 4b, spec §3). The game renders uncapped, so 120 Hz on a ProMotion
 * iPhone or iPad. If that cannot be held -- the 95th-percentile frame interval above 8.3 ms for
 * about 5 s running -- rendering locks to a steady 60 for the rest of the match, rather than
 * juddering between the two or heating the phone chasing a rate it cannot keep. The next match
 * (`reset`) tries 120 again.
 *
 * Render-side only: the sim steps at `FIXED_DT` whatever this decides, and `GameLoop` already
 * interpolates, so a skipped draw changes what is shown, never what happens.
 *
 * Allocation-free after construction: one ring of intervals and one scratch to sort for the
 * percentile, both fixed. On a 60 Hz screen it locks after 5 s, which changes nothing there.
 */

/** A frame slower than this is not a 120 Hz frame. */
export const GOVERNOR_TARGET_MS = 1000 / 120;
/** Consecutive one-second windows over target before the lock. */
export const GOVERNOR_STRIKES = 5;
/** Locked, a draw is due once this much has passed: past one 120 Hz frame, short of a 60 Hz one. */
const LOCKED_MIN_INTERVAL_MS = 1000 / 60 - 1000 / 240;
/** Room for one second of 120 Hz frames and then some. */
const WINDOW_CAPACITY = 256;
const WINDOW_MS = 1000;

export type GovernorMode = "uncapped" | "locked60";

export class FrameGovernor {
  mode: GovernorMode = "uncapped";
  private readonly window = new Float32Array(WINDOW_CAPACITY);
  private readonly sorted = new Float32Array(WINDOW_CAPACITY);
  private count = 0;
  private windowStart = -1;
  private strikes = 0;
  private lastDraw = -Infinity;

  /**
   * Whether to draw the frame at `nowMs` (the rAF timestamp). Uncapped, always. Locked, only once
   * `LOCKED_MIN_INTERVAL_MS` has passed since the last drawn frame, which on a 120 Hz display is
   * every other frame.
   */
  shouldDraw(nowMs: number): boolean {
    if (this.mode === "uncapped") return true;
    if (nowMs - this.lastDraw < LOCKED_MIN_INTERVAL_MS) return false;
    this.lastDraw = nowMs;
    return true;
  }

  /**
   * One drawn frame's interval from the last, in ms. Once a second it takes the window's 95th
   * percentile, counting a strike when it is over `GOVERNOR_TARGET_MS` and clearing the count when
   * it is not; `GOVERNOR_STRIKES` in a row lock the mode.
   */
  record(nowMs: number, intervalMs: number): void {
    if (this.mode !== "uncapped") return;
    if (this.windowStart < 0) this.windowStart = nowMs;
    if (this.count < WINDOW_CAPACITY) this.window[this.count++] = intervalMs;
    if (nowMs - this.windowStart < WINDOW_MS) return;

    const over = this.percentile95() > GOVERNOR_TARGET_MS;
    this.strikes = over ? this.strikes + 1 : 0;
    this.count = 0;
    this.windowStart = nowMs;
    if (this.strikes >= GOVERNOR_STRIKES) {
      this.mode = "locked60";
      this.lastDraw = nowMs;
    }
  }

  /** A new match: try 120 again. */
  reset(): void {
    this.mode = "uncapped";
    this.count = 0;
    this.windowStart = -1;
    this.strikes = 0;
    this.lastDraw = -Infinity;
  }

  private percentile95(): number {
    const n = this.count;
    if (n === 0) return 0;
    const s = this.sorted.subarray(0, n);
    s.set(this.window.subarray(0, n));
    s.sort();
    return s[Math.min(n - 1, Math.floor(n * 0.95))]!;
  }
}
