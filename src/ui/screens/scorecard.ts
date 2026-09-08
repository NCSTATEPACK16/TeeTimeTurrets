import type { HoleResult, Round } from "../../sim/round";

/**
 * Image 13's scorecard as data. DOM-free, so it tests in the node environment -- the same split
 * `hudState.ts` uses, and the reason `ResultsScreen.ts` below it stays a dumb writer.
 *
 * Nine columns always. `ROADMAP.md` is explicit that the card ships nine-column with one hole
 * live, because the layout is the expensive part and multi-hole then fills columns without the
 * screen changing. Padding here rather than in the DOM keeps that promise in a testable place.
 */

export const CARD_COLUMNS = 9;

export interface ScorecardHole {
  /** 1-based, as a player counts holes. */
  readonly label: string;
  /** Empty string past the end of a short round -- a cell with nothing to say, not a zero. */
  readonly par: string;
  readonly strokes: string;
  readonly result: HoleResult | null;
}

export interface StatTile {
  readonly label: string;
  readonly value: string;
}

export interface ScorecardView {
  readonly holes: readonly ScorecardHole[];
  readonly totalPar: string;
  readonly totalStrokes: string;
  /** Score against par, card-style: "E", "-3", "+2". */
  readonly relative: string;
  readonly complete: boolean;
  readonly tiles: readonly StatTile[];
}

export function deriveScorecard(round: Round): ScorecardView {
  const card = round.card;
  const holes: ScorecardHole[] = [];
  for (let i = 0; i < CARD_COLUMNS; i++) {
    const hole = card[i];
    holes.push({
      label: String(i + 1),
      par: hole ? String(hole.par) : "",
      strokes: hole?.strokes == null ? "" : String(hole.strokes),
      result: hole?.result ?? null,
    });
  }

  // Totals cover the columns actually shown, not the whole course. An 18-hole course under a
  // nine-column card would otherwise print a PAR row of nine numbers beside a TOTAL of all
  // eighteen -- a row that visibly does not add up. This is the OUT total of a front-nine card;
  // when the card grows to eighteen columns the same sum becomes the round total.
  const shown = card.slice(0, CARD_COLUMNS);
  const stats = round.stats;
  return {
    holes,
    totalPar: String(shown.reduce((sum, hole) => sum + hole.par, 0)),
    totalStrokes: String(shown.reduce((sum, hole) => sum + (hole.strokes ?? 0), 0)),
    relative: formatRelative(round.relativeToPar),
    complete: round.complete,
    // The four tiles are the Phase 3.5 economy's only input, so they are reported from the start
    // even while three of them read zero in stroke play.
    tiles: [
      { label: "DIRECT HITS", value: String(stats.directHits) },
      { label: "LONGEST DRIVE", value: `${Math.round(stats.longestDriveM)} m` },
      { label: "TARGETS DOWN", value: String(stats.targetsDown) },
      { label: "ACCURACY", value: `${Math.round(round.accuracy * 100)}%` },
    ],
  };
}

/** "E" for level, an explicit sign otherwise. A card never shows "+0". */
export function formatRelative(relative: number): string {
  if (relative === 0) return "E";
  return relative > 0 ? `+${relative}` : String(relative);
}
