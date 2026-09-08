import type { Stats } from "./stats";

/**
 * What a hole is worth, spent in the clubhouse.
 *
 * `ROADMAP.md` Phase 3.5 says the purse comes from the four Phase 1.75 stat tiles -- direct hits,
 * longest drive, targets down, accuracy -- which is why those were recorded from the start even
 * while three of them read zero in stroke play. This reads exactly those and invents no new
 * source of score.
 *
 * **It prices one hole, not a round**, and that is the whole reason this file changed. Paying a
 * round-scoped purse after every hole pays for hole 1 again on hole 2 and again on hole 3, which
 * is what the old shape did the moment the card stopped being wiped between holes. A hole is
 * priced from its own numbers and paid once. `session.test.ts` holds the guard.
 *
 * Rates are starting values for playtesting, not measured constants. Tune by feel.
 */
export const EARNINGS = {
  perDirectHit: 25,
  perTargetDown: 60,
  /** A 100 m drive is worth 100 coins. */
  perDriveMetre: 1,
  /** Golf still pays: every stroke under par, on the hole just played. */
  perStrokeUnderPar: 150,
} as const;

/**
 * Whole coins, never negative. A hole played badly earns nothing rather than costing the player
 * money -- a negative purse would mean a bad hole could strip a cosmetic they already own, and
 * nothing in the design says losing should take things away.
 */
export function earningsForHole(stats: Readonly<Stats>, strokes: number, par: number): number {
  const underPar = Math.max(0, par - strokes);

  const purse =
    stats.directHits * EARNINGS.perDirectHit +
    stats.targetsDown * EARNINGS.perTargetDown +
    stats.longestDriveM * EARNINGS.perDriveMetre +
    underPar * EARNINGS.perStrokeUnderPar;

  return Math.max(0, Math.round(purse));
}
