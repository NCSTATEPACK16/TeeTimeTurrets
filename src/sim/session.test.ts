import { describe, expect, it } from "vitest";
import { Session } from "./session";
import { createStats } from "./stats";
import type { Stats } from "./stats";
import { EARNINGS } from "./wallet";

/**
 * Playing more than one hole.
 *
 * Every assertion here is about the seam between `Sim` (one hole) and `Round` (the sequence),
 * which had no owner and so had no test. `main.ts` did the advancing inline and got it wrong in a
 * way nothing in the suite could see: `round.test.ts` was green throughout, because `Round` used
 * correctly does exactly what it says. The defect was in the *using*.
 *
 * `docs/TEST-AND-SPEC-PITFALLS.md` is the reason these are written as multi-hole sequences rather
 * than as single calls. A one-hole test passes under both the broken and the fixed orchestration;
 * only the third hole tells them apart.
 */

/** A finished hole's counters, as `Sim.stats` would hand them over. */
function holeStats(over: Partial<Stats> = {}): Stats {
  return { ...createStats(), ...over };
}

describe("session", () => {
  it("plays three different holes, in order", () => {
    const session = new Session([4, 3, 5, 4]);
    const played: number[] = [];

    for (let i = 0; i < 3; i++) {
      played.push(session.holeIndex);
      session.startHole(holeStats());
      session.completeHole(4);
    }

    expect(played).toEqual([0, 1, 2]);
  });

  it("keeps every hole's score on the card", () => {
    const session = new Session([4, 3, 5]);

    session.startHole(holeStats());
    session.completeHole(5);
    session.startHole(holeStats());
    session.completeHole(2);
    session.startHole(holeStats());
    session.completeHole(6);

    expect(session.card.card.map((c) => c.strokes)).toEqual([5, 2, 6]);
    expect(session.card.totalStrokes).toBe(13);
    // 13 strokes against a par of 12.
    expect(session.card.relativeToPar).toBe(1);
  });

  it("is complete once the last hole is scored, and not before", () => {
    const session = new Session([4, 3]);

    session.startHole(holeStats());
    session.completeHole(4);
    expect(session.complete).toBe(false);

    session.startHole(holeStats());
    session.completeHole(3);
    expect(session.complete).toBe(true);
  });

  it("clamps the hole index once the round is over rather than running off the end", () => {
    const session = new Session([4, 3]);

    session.startHole(holeStats());
    session.completeHole(4);
    session.startHole(holeStats());
    session.completeHole(3);

    expect(session.holeIndex).toBe(1);
  });

  /**
   * The bug the per-hole purse exists to prevent, and the reason `earningsFor(round)` could not
   * simply be called every hole once the card persisted: a round-scoped purse paid per hole pays
   * for hole 1 again on hole 2, and again on hole 3.
   *
   * Three identical holes, each worth exactly one direct hit. The player should be paid three
   * times for three hits, not six times.
   */
  it("pays for each hole once, not for the whole round again every hole", () => {
    const session = new Session([4, 4, 4]);
    const earned: number[] = [];

    for (let i = 0; i < 3; i++) {
      session.startHole(holeStats({ directHits: 1 }));
      earned.push(session.completeHole(4));
    }

    expect(earned).toEqual([
      EARNINGS.perDirectHit,
      EARNINGS.perDirectHit,
      EARNINGS.perDirectHit,
    ]);
    expect(session.coins).toBe(3 * EARNINGS.perDirectHit);
  });

  it("pays a longest drive once, not once per remaining hole", () => {
    const session = new Session([4, 4, 4]);

    session.startHole(holeStats({ longestDriveM: 100 }));
    session.completeHole(4);
    session.startHole(holeStats());
    session.completeHole(4);
    session.startHole(holeStats());
    session.completeHole(4);

    expect(session.coins).toBe(100 * EARNINGS.perDriveMetre);
  });

  it("accumulates the four scorecard tiles across the round", () => {
    const session = new Session([4, 4]);

    session.startHole(holeStats({ shotsFired: 5, directHits: 2, targetsDown: 1, longestDriveM: 80 }));
    session.completeHole(4);
    session.startHole(holeStats({ shotsFired: 3, directHits: 1, targetsDown: 2, longestDriveM: 120 }));
    session.completeHole(4);

    const stats = session.card.stats;
    expect(stats.shotsFired).toBe(8);
    expect(stats.directHits).toBe(3);
    expect(stats.targetsDown).toBe(3);
    // A round best, not a sum: the longest drive is one drive.
    expect(stats.longestDriveM).toBe(120);
  });

  it("spends coins without touching the card", () => {
    const session = new Session([4], 1000);
    session.spend(250);
    expect(session.coins).toBe(750);
  });
});
