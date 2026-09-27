import { describe, expect, it } from "vitest";
import { LosSchedule } from "./losSchedule";

describe("LosSchedule", () => {
  it("asks for each cart's sight line once a period, not every frame", () => {
    const schedule = new LosSchedule(1, 100);
    let checks = 0;
    for (let ms = 0; ms < 1000; ms += 16) {
      if (schedule.due(0, ms)) {
        checks++;
        schedule.done(0, ms);
      }
    }
    expect(checks).toBeGreaterThanOrEqual(9);
    expect(checks).toBeLessThanOrEqual(11);
  });

  it("staggers the carts across the period, so they do not all land on one frame", () => {
    const schedule = new LosSchedule(8, 100);
    const firstDue: number[] = [];
    for (let i = 0; i < 8; i++) {
      for (let ms = 0; ms <= 100; ms++) {
        if (schedule.due(i, ms)) {
          firstDue.push(ms);
          break;
        }
      }
    }
    expect(new Set(firstDue).size).toBe(8);
    expect(Math.max(...firstDue)).toBeLessThan(100);
  });

  it("is due at once when told a cart's answer is stale", () => {
    const schedule = new LosSchedule(2, 100);
    schedule.done(1, 50);
    expect(schedule.due(1, 60)).toBe(false);
    schedule.invalidate(1);
    expect(schedule.due(1, 60)).toBe(true);
  });
});
