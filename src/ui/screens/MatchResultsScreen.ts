import { deriveScoreboard } from "../matchScoreboard";
import type { FlagRow, ScoreboardRow } from "../matchScoreboard";
import { el, on } from "../dom";
import type { Screen } from "../../app/ScreenManager";
import type { Match } from "../../sim/match";
import { xpToNext } from "../../sim/scoring";
import type { Earnings } from "../../sim/scoring";
import { DRIVER_UNLOCK_LEVEL } from "../../sim/upgrades";

/**
 * Arena's ending: the winning side, both teams' strokes, the MVP with their kills, and the full
 * roster, per D12 (docs/superpowers/specs/2026-09-09-arena-match-and-scoring-design.md).
 *
 * A real `Screen`, not the static `#match-results` overlay `RoundScreen` already draws for
 * stroke play's cart-combat ending -- that overlay's numbers are `Cart.strokesTaken` and
 * `Sim.matchOutcome()`, the cart-combat mode's own count (ball hits absorbed) from the 3
 * September session. Reusing it for arena would show hits-absorbed as though it were the
 * scoreboard, which is exactly the mismeasure D1 in `src/sim/match.ts` exists to prevent.
 *
 * The derivation (`matchScoreboard.ts`'s `deriveScoreboard`) already existed before this screen
 * did -- this class is only the writing half, same split as `ResultsScreen`/`scorecard.ts`.
 */

export interface MatchResultsActions {
  readonly playAgain: () => void;
  readonly mainMenu: () => void;
}

/** What the match paid the player, and where it left them (Stage 8). Already credited and saved. */
export interface ResultsEarnings {
  readonly earned: Earnings;
  readonly levelBefore: number;
  readonly level: number;
  /** XP into `level`. */
  readonly xp: number;
}

export interface MatchResultsScreenOptions {
  readonly root: HTMLElement;
  readonly match: Match;
  readonly actions: MatchResultsActions;
  /** Painted behind the card so the course is still visible through the scrim. */
  readonly drawBehind?: () => void;
  readonly earnings?: ResultsEarnings;
}

export class MatchResultsScreen implements Screen {
  private readonly options: MatchResultsScreenOptions;
  private container: HTMLElement | null = null;
  private readonly teardown: (() => void)[] = [];

  constructor(options: MatchResultsScreenOptions) {
    this.options = options;
  }

  enter(): void {
    const { root, match, actions } = this.options;

    // A mouse-aim player is pointer-locked with the cursor captured; without this, PLAY AGAIN
    // and MAIN MENU are buttons nobody can reach. D12.
    if (document.pointerLockElement !== null) document.exitPointerLock();

    const state = deriveScoreboard(match);

    const buttons = el("div", { class: "arena-results__actions" });
    const playAgain = el("button", { class: "btn btn--primary", type: "button", text: "PLAY AGAIN" });
    this.teardown.push(on(playAgain, "click", actions.playAgain));
    const mainMenu = el("button", { class: "btn", type: "button", text: "MAIN MENU", attrs: { "data-pad-back": "" } });
    this.teardown.push(on(mainMenu, "click", actions.mainMenu));
    buttons.append(playAgain, mainMenu);

    this.container = el("div", { class: "screen screen--scrim arena-results" }, [
      el("div", { class: "panel arena-results__panel" }, [
        el("h1", { class: "arena-results__title", text: state.headline }),
        el("div", { class: "arena-results__score" }, [
          el("span", { class: "arena-results__score-value", text: state.usText }),
          el("span", { class: "arena-results__score-value", text: state.themText }),
        ]),
        el("p", { class: "arena-results__mvp", text: state.mvpText }),
        el(
          "div",
          { class: "arena-results__rows" },
          [...state.rows.map(buildRow), ...state.flagRows.map(buildFlagRow)],
        ),
        ...(this.options.earnings ? [buildEarnings(this.options.earnings)] : []),
        buttons,
      ]),
    ]);
    root.append(this.container);
  }

  step(): void {
    // The match is over; nothing advances behind this screen.
  }

  draw(): void {
    // Keeps the finished arena on screen under the scrim rather than a black page, same as
    // ResultsScreen does for a finished hole.
    this.options.drawBehind?.();
  }

  exit(): void {
    for (const off of this.teardown) off();
    this.teardown.length = 0;
    this.container?.remove();
    this.container = null;
  }
}

/** `+SCORE`, `+COINS`, the level with its XP bar, and a line for a level-up or the driver unlock. */
function buildEarnings(e: ResultsEarnings): HTMLElement {
  const toNext = xpToNext(e.level);
  const lines: HTMLElement[] = [
    el("div", { class: "arena-results__earned" }, [
      el("span", { text: `+${e.earned.score} SCORE` }),
      el("span", { text: `+${e.earned.coins} ◉` }),
    ]),
    el("div", { class: "arena-results__level", text: `LEVEL ${e.level} · ${e.xp} / ${toNext} XP` }),
    el("div", { class: "meter" }, [
      el("div", { class: "meter__fill", style: { width: `${Math.round((100 * e.xp) / toNext)}%` } }),
    ]),
  ];
  if (e.level > e.levelBefore) {
    const unlocked = e.levelBefore < DRIVER_UNLOCK_LEVEL && e.level >= DRIVER_UNLOCK_LEVEL;
    lines.push(
      el("div", {
        class: "arena-results__levelup",
        text: unlocked ? `LEVEL ${e.level} · DRIVER UNLOCKED` : `LEVEL ${e.level}`,
      }),
    );
  }
  return el("div", { class: "arena-results__earnings" }, lines);
}

/** A side's strokes bled to the other side's flags: its own line, under that side's players. */
function buildFlagRow(row: FlagRow): HTMLElement {
  const side = row.team === 0 ? "ally" : "enemy";
  return el("div", { class: "arena-results__row" }, [
    el("span", { class: `arena-results__row-name arena-results__row-name--${side}`, text: row.team === 0 ? "US" : "THEM" }),
    el("span", { class: "arena-results__row-stat", text: "" }),
    el("span", { class: "arena-results__row-stat", text: row.text }),
  ]);
}

/** Team colour on the name only, matching `Nameplates`' identical convention. */
function buildRow(row: ScoreboardRow): HTMLElement {
  const side = row.team === 0 ? "ally" : "enemy";
  return el("div", { class: "arena-results__row" }, [
    el("span", { class: `arena-results__row-name arena-results__row-name--${side}`, text: row.name }),
    el("span", { class: "arena-results__row-stat", text: `${row.points} KILLS` }),
    el("span", { class: "arena-results__row-stat", text: `${row.strokes} DEATHS` }),
  ]);
}
