import { describe, expect, it } from "vitest";
import { FRAME_STATS_WINDOW, FrameStats } from "./frameStats";

/**
 * The dev readout's arithmetic. What it reports is the numbers a performance claim in a PR rests
 * on, so the percentiles are checked against hand-worked windows, and the window is checked to
 * forget: a readout still averaging in the loading hitch a minute later is lying about now.
 */

describe("FrameStats", () => {
  it("reports nothing before two frames, since one frame has no interval", () => {
    const stats = new FrameStats();
    expect(stats.summary().frames).toBe(0);
    stats.record(1000, 4, 10, 100);
    expect(stats.summary().frames).toBe(0);
  });

  it("measures frame time between frames, and work and draws within one", () => {
    const stats = new FrameStats();
    let now = 1000;
    stats.record(now, 1, 1, 1);
    // Ten frames: nine at 16 ms and one 50 ms hitch; work 4 ms except 9 ms on the hitch.
    for (let i = 0; i < 10; i++) {
      now += i === 9 ? 50 : 16;
      stats.record(now, i === 9 ? 9 : 4, 120 + i, 5000);
    }
    const s = stats.summary();
    expect(s.frames).toBe(10);
    expect(s.frameMs.median).toBe(16);
    expect(s.frameMs.max).toBe(50);
    // p95 of ten samples is the tenth: the hitch.
    expect(s.frameMs.p95).toBe(50);
    expect(s.fps).toBeCloseTo(1000 / ((16 * 9 + 50) / 10), 6);
    expect(s.workMs.median).toBe(4);
    expect(s.workMs.p95).toBe(9);
    expect(s.drawCalls.median).toBe(124);
    expect(s.drawCalls.max).toBe(129);
    expect(s.triangles.median).toBe(5000);
  });

  it("forgets frames older than its window", () => {
    const stats = new FrameStats();
    let now = 0;
    stats.record(now, 0, 0, 0);
    // A loading hitch, then a full window of steady frames.
    now += 500;
    stats.record(now, 400, 0, 0);
    for (let i = 0; i < FRAME_STATS_WINDOW; i++) {
      now += 20;
      stats.record(now, 5, 90, 1000);
    }
    const s = stats.summary();
    expect(s.frames).toBe(FRAME_STATS_WINDOW);
    expect(s.frameMs.max).toBe(20);
    expect(s.workMs.p95).toBe(5);
  });

  it("starts again after a reset, so a new screen is not measured against the last", () => {
    const stats = new FrameStats();
    stats.record(0, 1, 1, 1);
    stats.record(16, 1, 1, 1);
    stats.reset();
    expect(stats.summary().frames).toBe(0);
    stats.record(100, 1, 1, 1);
    expect(stats.summary().frames).toBe(0);
  });
});
