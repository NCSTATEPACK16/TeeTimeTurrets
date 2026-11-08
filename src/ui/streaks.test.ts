import { describe, expect, it } from "vitest";
import { StreakTracker } from "./streaks";
import { countdownBeat } from "./countdown";

describe("killstreak callouts", () => {
  it("scores multi-kills inside the window and streaks without dying", () => {
    const t = new StreakTracker();
    expect(t.onKill(10)).toBeNull();
    expect(t.onKill(12)?.headline).toBe("BIRDIE!");
    expect(t.onKill(15)?.headline).toBe("EAGLE!"); // also the 3-streak; the multi-kill wins
    expect(t.onKill(30)).toBeNull(); // out of the window, streak 4
    expect(t.onKill(60)?.headline).toBe("CLUB CHAMPION"); // streak 5
  });

  it("forgets the streak and the chain on death", () => {
    const t = new StreakTracker();
    t.onKill(1);
    t.onKill(20);
    t.onDeath();
    expect(t.onKill(21)).toBeNull();
    expect(t.onKill(40)).toBeNull();
    expect(t.onKill(60)?.headline).toBe("ON THE GREEN");
  });
});

describe("countdown beats", () => {
  it("leads in, counts 3-2-1, shouts FORE!, then clears", () => {
    const out = { label: "", beat: 0 };
    const labels = [3.7, 2.5, 1.5, 0.2].map((r) => countdownBeat(r, 0, out).label);
    expect(labels).toEqual(["TEE TIME", "3", "2", "1"]);
    expect(countdownBeat(0, 0.3, out).label).toBe("FORE!");
    expect(countdownBeat(0, 2, out)).toEqual({ label: "", beat: 0 });
  });
});
