import { describe, expect, it } from "vitest";
import { EARNINGS, earningsFor } from "./wallet";
import { Round } from "./round";

/**
 * The Phase 3.5 economy's only input is the four stat tiles image 13 records, so this converts
 * exactly those and nothing else. DOM-free, like the rest of src/sim/**.
 */

function playedRound(): Round {
  const round = new Round([4, 4, 4]);
  round.completeHole(3); // under par
  return round;
}

describe("earnings", () => {
  it("pays nothing for a round where nothing happened", () => {
    const round = new Round([4]);
    expect(earningsFor(round)).toBe(0);
  });

  it("pays per direct hit and per target downed", () => {
    const round = new Round([4]);
    round.recordShot();
    round.recordHit();
    round.recordTargetDown();
    expect(earningsFor(round)).toBe(EARNINGS.perDirectHit + EARNINGS.perTargetDown);
  });

  it("pays a longest-drive bonus by the metre", () => {
    const round = new Round([4]);
    round.recordDrive(100);
    expect(earningsFor(round)).toBe(Math.round(100 * EARNINGS.perDriveMetre));
  });

  it("pays an under-par bonus per stroke saved", () => {
    expect(earningsFor(playedRound())).toBe(EARNINGS.perStrokeUnderPar);
  });

  it("never pays a negative purse for a bad round", () => {
    const round = new Round([3]);
    round.completeHole(9); // six over
    expect(earningsFor(round)).toBe(0);
  });

  it("returns whole coins -- a fractional balance is not spendable", () => {
    const round = new Round([4]);
    round.recordDrive(83.7);
    expect(Number.isInteger(earningsFor(round))).toBe(true);
  });
});
