import { teamOf } from "../sim/matchConfig";
import { TEAM_DRAW, TEAM_PENDING } from "../sim/match";
import type { Match } from "../sim/match";

/**
 * The DOM-free half of the arena results scoreboard: a finished `Match` in, the strings and rows
 * the results screen prints out. Same split as `hudState.ts`/`hud.ts` and
 * `matchResultsState.ts`/`matchResults.ts` -- the rules live here and get asserted in Vitest's
 * node environment, and the writing half only puts strings into elements.
 *
 * Reads only. Per AGENTS.md, `src/ui/**` is a pure consumer of sim state.
 *
 * ## Why this takes a real `Match` and not a structural source
 *
 * Its neighbours in this directory take a structural slice of `Sim` so a test needs no Rapier
 * world. `Match` is already DOM-free, Rapier-free and cheap to construct, so there is nothing
 * here to escape -- and a structural source would let a fixture and the sim disagree about what
 * a draw is, which is the one thing this file exists to render.
 *
 * ## Why this allocates, when the rest of `src/ui/**` writes into a scratch
 *
 * The no-per-frame-allocation rule covers the render callback. This runs when a match ends: once
 * per match, behind an overlay that was just toggled visible. `rows` is a fresh array of a fresh
 * object each anyway -- a scratch would have to grow with the roster, which is the allocation it
 * was meant to avoid.
 */

/** The player is always rig 0 and always team 0; see `matchConfig.teamOf`. */
const PLAYER = 0;
const PLAYER_TEAM = 0;
const ENEMY_TEAM = 1;

/** One player's line. `points` are kills scored, `strokes` deaths suffered -- see `match.ts` on
 *  why a stroke here is a death and not the ball hits `Cart.strokesTaken` counts. */
export interface ScoreboardRow {
  readonly name: string;
  readonly team: number;
  readonly points: number;
  readonly strokes: number;
}

export interface ScoreboardState {
  /** Empty while the match is still running: `TEAM_PENDING` is not a result to render. */
  readonly headline: string;
  /** The player's side, on its own: `"US 1"`. */
  readonly usText: string;
  /** The other side, on its own: `"THEM 2"`. */
  readonly themText: string;
  /** `"MVP  BOT 1 — 2 KILLS"`. */
  readonly mvpText: string;
  /** One row per player in the roster, in rig order. */
  readonly rows: readonly ScoreboardRow[];
}

export function deriveScoreboard(match: Match): ScoreboardState {
  const rows: ScoreboardRow[] = [];
  // `match.playerCount`, never the array length: `Match` allocates for `MAX_PLAYERS` and scores
  // over the roster, so the arrays behind it are twenty-odd zeroes wide in this build.
  for (let i = 0; i < match.playerCount; i++) {
    rows.push({
      name: nameOf(i),
      team: teamOf(i),
      points: match.pointsFor(i),
      strokes: match.strokesFor(i),
    });
  }

  const mvp = match.mvp();

  return {
    headline: headlineFor(match.winningTeam()),
    // Split into two strings rather than the HUD's single `"US 4 — THEM 7"`, so the results
    // screen can lay them out either side of the headline.
    usText: `US ${match.teamStrokes(PLAYER_TEAM)}`,
    themText: `THEM ${match.teamStrokes(ENEMY_TEAM)}`,
    mvpText: `MVP  ${nameOf(mvp)} — ${killsText(match.pointsFor(mvp))}`,
    rows,
  };
}

/**
 * The team wins by dying least, so the badge can and does cross sides -- the MVP is whoever
 * killed most, on either team. Intended, and asserted, so a later reader does not "fix" it.
 */
function headlineFor(winner: number): string {
  if (winner === TEAM_PENDING) return "";
  if (winner === TEAM_DRAW) return "DRAW";
  return winner === PLAYER_TEAM ? "YOUR TEAM WINS" : "ENEMY TEAM WINS";
}

/** Rig 0 is the human; rig `n` is the `n`th bot, which is what `RoundScreen` labels its plates. */
function nameOf(index: number): string {
  return index === PLAYER ? "YOU" : `BOT ${index}`;
}

function killsText(points: number): string {
  return points === 1 ? "1 KILL" : `${points} KILLS`;
}
