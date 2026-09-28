/**
 * The dev readout behind `window.__teetimeturrets.perf`: frame time, CPU work per frame and draw
 * calls over the last few seconds. It is what a performance claim in a PR is read off, so it keeps
 * its window short enough to describe now, not the loading hitch a minute ago.
 *
 * `record` is called once per animation frame and allocates nothing; `summary` sorts copies and is
 * for a human or the smoke check to call now and then.
 *
 * Work is CPU time from the frame's first sim step to the end of its render call -- what the main
 * thread spent. GPU time is not visible from here; a frame interval well above the work time is
 * the sign the GPU, or the browser, is the one holding the frame.
 */

/** Frames kept: four seconds at 60 Hz. */
export const FRAME_STATS_WINDOW = 240;

export interface FrameSummary {
  /** Frame intervals in the window. */
  readonly frames: number;
  readonly fps: number;
  readonly frameMs: { readonly median: number; readonly p95: number; readonly max: number };
  readonly workMs: { readonly median: number; readonly p95: number };
  readonly drawCalls: { readonly median: number; readonly max: number };
  readonly triangles: { readonly median: number };
}

export class FrameStats {
  private readonly frameMs = new Float64Array(FRAME_STATS_WINDOW);
  private readonly workMs = new Float64Array(FRAME_STATS_WINDOW);
  private readonly calls = new Float64Array(FRAME_STATS_WINDOW);
  private readonly triangles = new Float64Array(FRAME_STATS_WINDOW);
  private next = 0;
  private count = 0;
  private lastMs = Number.NaN;

  /** One frame ended at `nowMs`, having spent `workMs` and drawn `calls` calls of `triangles`. */
  record(nowMs: number, workMs: number, calls: number, triangles: number): void {
    const last = this.lastMs;
    this.lastMs = nowMs;
    // The first frame has nothing to be an interval from.
    if (Number.isNaN(last)) return;
    const i = this.next;
    this.frameMs[i] = nowMs - last;
    this.workMs[i] = workMs;
    this.calls[i] = calls;
    this.triangles[i] = triangles;
    this.next = (i + 1) % FRAME_STATS_WINDOW;
    if (this.count < FRAME_STATS_WINDOW) this.count++;
  }

  reset(): void {
    this.next = 0;
    this.count = 0;
    this.lastMs = Number.NaN;
  }

  summary(): FrameSummary {
    const n = this.count;
    const frame = sorted(this.frameMs, n);
    const work = sorted(this.workMs, n);
    const calls = sorted(this.calls, n);
    const triangles = sorted(this.triangles, n);
    let total = 0;
    for (const ms of frame) total += ms;
    return {
      frames: n,
      fps: n > 0 && total > 0 ? 1000 / (total / n) : 0,
      frameMs: { median: rank(frame, 0.5), p95: rank(frame, 0.95), max: rank(frame, 1) },
      workMs: { median: rank(work, 0.5), p95: rank(work, 0.95) },
      drawCalls: { median: rank(calls, 0.5), max: rank(calls, 1) },
      triangles: { median: rank(triangles, 0.5) },
    };
  }
}

function sorted(values: Float64Array, n: number): Float64Array {
  return values.slice(0, n).sort();
}

/** Nearest-rank percentile: the smallest sample at least `p` of the window is at or below. */
function rank(values: Float64Array, p: number): number {
  if (values.length === 0) return 0;
  return values[Math.max(0, Math.ceil(p * values.length) - 1)]!;
}
