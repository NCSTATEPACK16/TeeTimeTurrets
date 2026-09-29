import { describe, expect, it } from "vitest";
import { FRAME_STATS_WINDOW, FrameStats, createFrameReport } from "./frameStats";

/** Records `n` frames `intervalMs` apart, each costing `workMs` and drawing `calls`. */
function feed(stats: FrameStats, n: number, intervalMs: number, workMs: number, calls: number, startMs = 0): number {
  let now = startMs;
  for (let i = 0; i < n; i++) {
    now += intervalMs;
    stats.record(now, workMs, calls, calls * 100);
  }
  return now;
}

describe("FrameStats", () => {
  it("reports the mean and 95th percentile of the frame interval, apart from the work", () => {
    const stats = new FrameStats();
    // The frame everything is measured from; it has no interval, so it is not in the window.
    stats.record(0, 0, 0, 0);
    // 94 frames at 60 Hz, 5 at 20 Hz and one 200 ms hitch: the 95th percentile is among the slow
    // ones, and the hitch is what a maximum would have reported instead.
    let now = feed(stats, 94, 1000 / 60, 4, 100);
    now = feed(stats, 5, 50, 12, 100, now);
    now = feed(stats, 1, 200, 40, 100, now);
    const report = stats.report(createFrameReport());
    expect(report.frameMs).toBeCloseTo((94 * (1000 / 60) + 5 * 50 + 200) / 100, 1);
    expect(report.frameMsP95).toBeCloseTo(50, 5);
    expect(report.workMs).toBeCloseTo((94 * 4 + 5 * 12 + 40) / 100, 5);
    expect(report.workMsP95).toBeCloseTo(12, 5);
    expect(report.frames).toBe(100);
  });

  it("reports the last frame's draw calls and triangles, and the most draw calls in the window", () => {
    const stats = new FrameStats();
    const now = feed(stats, 10, 16, 1, 300);
    feed(stats, 1, 16, 1, 150, now);
    const report = stats.report(createFrameReport());
    expect(report.drawCalls).toBe(150);
    expect(report.drawCallsMax).toBe(300);
    expect(report.triangles).toBe(15000);
  });

  it(`forgets frames older than its ${FRAME_STATS_WINDOW}-frame window`, () => {
    const stats = new FrameStats();
    const now = feed(stats, FRAME_STATS_WINDOW, 100, 50, 900);
    feed(stats, FRAME_STATS_WINDOW, 10, 2, 50, now);
    const report = stats.report(createFrameReport());
    expect(report.frameMs).toBeCloseTo(10, 5);
    expect(report.workMsP95).toBeCloseTo(2, 5);
    expect(report.drawCallsMax).toBe(50);
    expect(report.frames).toBe(FRAME_STATS_WINDOW);
  });

  /** The first frame has no previous one to measure from, and must not read as a 10-second frame. */
  it("measures no interval for the first frame, or the first after a reset", () => {
    const stats = new FrameStats();
    stats.record(10_000, 3, 10, 10);
    stats.record(10_016, 3, 10, 10);
    expect(stats.report(createFrameReport()).frameMs).toBeCloseTo(16, 5);
    stats.reset();
    stats.record(99_000, 3, 10, 10);
    expect(stats.report(createFrameReport()).frames).toBe(0);
  });
});
