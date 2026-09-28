/**
 * Frame time and draw calls over the last `FRAME_STATS_WINDOW` frames, for the dev readout
 * (`__teetimeturrets.perf`, and the `?perf` overlay) and for `tools/perfProbe.mjs`.
 *
 * Two times, because they answer different questions:
 * - **frame** is the interval between frames: what the player sees. At a 60 Hz display it sits on
 *   16.7 ms for as long as the work fits, so on its own it cannot say how much room is left.
 * - **work** is what the frame spent in the loop's own callbacks -- stepping and drawing -- on the
 *   CPU. The GPU's share is not in it; `perfProbe` adds a `gl.finish` when it wants that.
 *
 * `record` runs every frame, so it writes into fixed rings and allocates nothing. `report` sorts a
 * scratch copy for the percentiles and is for a reader polling a few times a second.
 *
 * No DOM and no three: the loop hands it numbers.
 */

export const FRAME_STATS_WINDOW = 120;

export interface FrameReport {
  /** Frames in the window with an interval: every recorded frame but the first. */
  frames: number;
  frameMs: number;
  frameMsP95: number;
  workMs: number;
  workMsP95: number;
  /** The most recent frame's. */
  drawCalls: number;
  triangles: number;
  drawCallsMax: number;
}

export function createFrameReport(): FrameReport {
  return { frames: 0, frameMs: 0, frameMsP95: 0, workMs: 0, workMsP95: 0, drawCalls: 0, triangles: 0, drawCallsMax: 0 };
}

export class FrameStats {
  private readonly interval = new Float64Array(FRAME_STATS_WINDOW);
  private readonly work = new Float64Array(FRAME_STATS_WINDOW);
  private readonly calls = new Float64Array(FRAME_STATS_WINDOW);
  private readonly sortScratch = new Float64Array(FRAME_STATS_WINDOW);
  private count = 0;
  private next = 0;
  private lastMs = Number.NaN;
  private lastCalls = 0;
  private lastTriangles = 0;

  /** One frame: when it started, what its callbacks cost, and what the renderer drew. */
  record(nowMs: number, workMs: number, drawCalls: number, triangles: number): void {
    this.lastCalls = drawCalls;
    this.lastTriangles = triangles;
    if (Number.isNaN(this.lastMs)) {
      this.lastMs = nowMs;
      return;
    }
    this.interval[this.next] = nowMs - this.lastMs;
    this.work[this.next] = workMs;
    this.calls[this.next] = drawCalls;
    this.lastMs = nowMs;
    this.next = (this.next + 1) % FRAME_STATS_WINDOW;
    if (this.count < FRAME_STATS_WINDOW) this.count++;
  }

  /** Forget everything, including when the last frame was: the next frame measures no interval. */
  reset(): void {
    this.count = 0;
    this.next = 0;
    this.lastMs = Number.NaN;
  }

  report(out: FrameReport): FrameReport {
    const n = this.count;
    out.frames = n;
    out.drawCalls = this.lastCalls;
    out.triangles = this.lastTriangles;
    out.frameMs = mean(this.interval, n);
    out.workMs = mean(this.work, n);
    out.frameMsP95 = this.p95(this.interval, n);
    out.workMsP95 = this.p95(this.work, n);
    let most = 0;
    for (let i = 0; i < n; i++) most = Math.max(most, this.calls[i]!);
    out.drawCallsMax = most;
    return out;
  }

  private p95(ring: Float64Array, n: number): number {
    if (n === 0) return 0;
    const sorted = this.sortScratch.subarray(0, n);
    sorted.set(ring.subarray(0, n));
    sorted.sort();
    return sorted[Math.min(n - 1, Math.floor(n * 0.95))]!;
  }
}

function mean(ring: Float64Array, n: number): number {
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += ring[i]!;
  return sum / n;
}
