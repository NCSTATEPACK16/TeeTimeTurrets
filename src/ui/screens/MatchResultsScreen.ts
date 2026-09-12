import { deriveScoreboard } from "../matchScoreboard";
import type { ScoreboardRow } from "../matchScoreboard";
import { el, on } from "../dom";
import type { Screen } from "../../app/ScreenManager";
import type { Match } from "../../sim/match";

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

export interface MatchResultsScreenOptions {
  readonly root: HTMLElement;
  readonly match: Match;
  readonly actions: MatchResultsActions;
  /** Painted behind the card so the course is still visible through the scrim. */
  readonly drawBehind?: () => void;
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
    const mainMenu = el("button", { class: "btn", type: "button", text: "MAIN MENU" });
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
          state.rows.map(buildRow),
        ),
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

/** Team colour on the name only, matching `Nameplates`' identical convention. */
function buildRow(row: ScoreboardRow): HTMLElement {
  const side = row.team === 0 ? "ally" : "enemy";
  return el("div", { class: "arena-results__row" }, [
    el("span", { class: `arena-results__row-name arena-results__row-name--${side}`, text: row.name }),
    el("span", { class: "arena-results__row-stat", text: `${row.points} KILLS` }),
    el("span", { class: "arena-results__row-stat", text: `${row.strokes} DEATHS` }),
  ]);
}
