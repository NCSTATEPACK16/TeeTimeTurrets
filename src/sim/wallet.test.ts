import { describe, expect, it } from "vitest";
import { EARNINGS, earningsForHole } from "./wallet";
import { createStats } from "./stats";
import type { Stats } from "./stats";

/**
 * The Phase 3.5 economy's only input is the four stat tiles image 13 records, so this converts
 * exactly those and nothing else. DOM-free, like the rest of src/sim/**.
 *
 * It prices a **hole**, not a round. Why that matters, and the double-payment it prevents, is in
 * `wallet.ts`'s header and asserted end to end in `session.test.ts`.
 */

function stats(over: Partial<Stats> = {}): Stats {
  return { ...createStats(), ...over };
}

describe("earnings", () => {
  it("pays nothing for a hole where nothing happened", () => {
    expect(earningsForHole(stats(), 4, 4)).toBe(0);
  });

  it("pays per direct hit and per target downed", () => {
    const purse = earningsForHole(stats({ shotsFired: 1, directHits: 1, targetsDown: 1 }), 4, 4);
    expect(purse).toBe(EARNINGS.perDirectHit + EARNINGS.perTargetDown);
  });

  it("pays a longest-drive bonus by the metre", () => {
    expect(earningsForHole(stats({ longestDriveM: 100 }), 4, 4)).toBe(
      Math.round(100 * EARNINGS.perDriveMetre),
    );
  });

  it("pays an under-par bonus per stroke saved on the hole", () => {
    expect(earningsForHole(stats(), 3, 4)).toBe(EARNINGS.perStrokeUnderPar);
    expect(earningsForHole(stats(), 2, 4)).toBe(2 * EARNINGS.perStrokeUnderPar);
  });

  it("never pays a negative purse for a hole played badly", () => {
    expect(earningsForHole(stats(), 9, 3)).toBe(0);
  });

  /**
   * An over-par hole must not eat the bonus a good drive on it earned. Six over against a 100 m
   * drive is the case: the under-par term floors at zero rather than going negative, so the drive
   * still pays.
   */
  it("floors only the under-par term, not the whole purse", () => {
    expect(earningsForHole(stats({ longestDriveM: 100 }), 9, 3)).toBe(
      Math.round(100 * EARNINGS.perDriveMetre),
    );
  });

  it("returns whole coins -- a fractional balance is not spendable", () => {
    expect(Number.isInteger(earningsForHole(stats({ longestDriveM: 83.7 }), 4, 4))).toBe(true);
  });
});
