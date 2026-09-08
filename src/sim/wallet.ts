import type { Round } from "./round";

/**
 * Round earnings, spent in the clubhouse.
 *
 * `ROADMAP.md` Phase 3.5 says the purse comes from the four Phase 1.75 stat tiles -- direct hits,
 * longest drive, targets down, accuracy -- which is why those were recorded from the start even
 * while three of them read zero in stroke play. This reads exactly those and invents no new
 * source of score.
 *
 * Rates are starting values for playtesting, not measured constants. Tune by feel.
 */
export const EARNINGS = {
  perDirectHit: 25,
  perTargetDown: 60,
  /** A 100 m drive is worth 100 coins. */
  perDriveMetre: 1,
  /** Golf still pays: every stroke under par on the holes actually played. */
  perStrokeUnderPar: 150,
} as const;

/**
 * Whole coins, never negative. A round played badly earns nothing rather than costing the player
 * money -- a negative purse would mean a bad round could strip a cosmetic they already own, and
 * nothing in the design says losing should take things away.
 */
export function earningsFor(round: Round): number {
  const stats = round.stats;
  const underPar = Math.max(0, -round.relativeToPar);

  const purse =
    stats.directHits * EARNINGS.perDirectHit +
    stats.targetsDown * EARNINGS.perTargetDown +
    stats.longestDriveM * EARNINGS.perDriveMetre +
    underPar * EARNINGS.perStrokeUnderPar;

  return Math.max(0, Math.round(purse));
}
