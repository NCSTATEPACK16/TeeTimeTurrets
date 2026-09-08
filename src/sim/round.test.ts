import { describe, expect, it } from "vitest";
import { Round } from "./round";

/**
 * A round is a list of holes; `Sim` is one hole's physics. ARCHITECTURE.md keeps them apart
 * deliberately, and ROADMAP.md warns that merging the two is what makes multi-hole expensive
 * later -- so nothing here touches Rapier, and this file runs in the node environment like the
 * rest of src/sim/**.
 *
 * Image 13's scorecard is the consumer: nine columns plus TOTAL, a PAR row and a STROKES row,
 * under-par ringed and over-par boxed, and four stat tiles that Phase 3.5 spends as currency.
 */

const PARS = [4, 3, 5, 4, 4, 3, 4, 5, 4]; // 36

function round(pars: readonly number[] = PARS): Round {
  return new Round(pars);
}

function playAll(r: Round, strokes: readonly number[]): void {
  for (const s of strokes) r.completeHole(s);
}

describe("the card", () => {
  it("starts on the first hole with nothing recorded", () => {
    const r = round();
    expect(r.holeIndex).toBe(0);
    expect(r.complete).toBe(false);
    expect(r.card.every((c) => c.strokes === null)).toBe(true);
  });

  it("exposes par per hole and the course total", () => {
    const r = round();
    expect(r.card.map((c) => c.par)).toEqual(PARS);
    expect(r.totalPar).toBe(36);
  });

  it("records strokes against the hole just played and advances", () => {
    const r = round();
    r.completeHole(5);
    expect(r.card[0]?.strokes).toBe(5);
    expect(r.holeIndex).toBe(1);
    expect(r.card[1]?.strokes).toBeNull();
  });

  it("totals only the holes actually played", () => {
    const r = round();
    playAll(r, [4, 4, 6]);
    expect(r.totalStrokes).toBe(14);
    // Par-so-far, not course par: a card showing +14 through three holes would be nonsense.
    expect(r.parThrough).toBe(12);
    expect(r.relativeToPar).toBe(2);
  });

  it("reports level par as 0, not -0", () => {
    const r = round();
    playAll(r, [4, 3]);
    expect(Object.is(r.relativeToPar, 0)).toBe(true);
  });

  it("finishes after the last hole and refuses further scores", () => {
    const r = round();
    playAll(r, PARS);
    expect(r.complete).toBe(true);
    expect(r.relativeToPar).toBe(0);
    expect(() => r.completeHole(4)).toThrow(/complete/i);
  });

  it("rejects a stroke count that cannot have happened", () => {
    const r = round();
    expect(() => r.completeHole(0)).toThrow(/strokes/i);
    expect(() => r.completeHole(-1)).toThrow(/strokes/i);
    expect(() => r.completeHole(2.5)).toThrow(/strokes/i);
  });

  it("needs at least one hole to be a round at all", () => {
    expect(() => new Round([])).toThrow(/hole/i);
  });
});

describe("scorecard presentation, per image 13", () => {
  it("marks each played hole under, level or over par", () => {
    const r = round([4, 4, 4]);
    playAll(r, [3, 4, 6]);
    expect(r.card.map((c) => c.result)).toEqual(["under", "level", "over"]);
  });

  it("leaves unplayed holes without a result to style", () => {
    const r = round([4, 4, 4]);
    r.completeHole(3);
    expect(r.card[1]?.result).toBeNull();
  });
});

describe("round stats -- the four tiles Phase 3.5 spends", () => {
  it("starts every tile at zero", () => {
    const r = round();
    expect(r.stats).toEqual({ shotsFired: 0, directHits: 0, targetsDown: 0, longestDriveM: 0 });
    expect(r.accuracy).toBe(0);
  });

  it("keeps the longest drive, not the latest", () => {
    const r = round();
    r.recordDrive(84.2);
    r.recordDrive(31.9);
    expect(r.stats.longestDriveM).toBeCloseTo(84.2, 3);
  });

  it("derives accuracy from hits over shots and never returns NaN", () => {
    const r = round();
    expect(r.accuracy).toBe(0);
    r.recordShot();
    r.recordShot();
    r.recordHit();
    expect(r.accuracy).toBeCloseTo(0.5, 6);
  });

  it("accumulates across holes -- stats are round-scoped, strokes are per-hole", () => {
    const r = round();
    r.recordShot();
    r.completeHole(4);
    r.recordShot();
    expect(r.stats.shotsFired).toBe(2);
  });
});
