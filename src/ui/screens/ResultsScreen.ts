import { CARD_COLUMNS, deriveScorecard } from "./scorecard";
import type { ScorecardView } from "./scorecard";
import { el, on } from "../dom";
import type { Screen } from "../../app/ScreenManager";
import type { Round } from "../../sim/round";

/**
 * Image 13. `RESULTS` over a nine-column card with `PAR` and `STROKES` rows and a `TOTAL` column,
 * under-par cells ringed and over-par boxed, the four stat tiles, then `MAIN MENU` / `NEXT HOLE`.
 *
 * Every number comes from `deriveScorecard`, which is tested on its own in the node environment.
 * This class only writes what that hands it -- the split that makes the card's logic testable
 * without a DOM, exactly as `hudState.ts` / `hud.ts` do it.
 *
 * Ships nine-column with one hole live. The layout is the expensive part; multi-hole then fills
 * columns without this file changing.
 */

export interface ResultsActions {
  readonly mainMenu: () => void;
  readonly nextHole?: () => void;
}

export interface ResultsScreenOptions {
  readonly root: HTMLElement;
  readonly round: Round;
  readonly actions: ResultsActions;
  /** Painted behind the card so the course is still visible through the scrim. */
  readonly drawBehind?: () => void;
}

export class ResultsScreen implements Screen {
  private readonly options: ResultsScreenOptions;
  private container: HTMLElement | null = null;
  private readonly teardown: (() => void)[] = [];

  constructor(options: ResultsScreenOptions) {
    this.options = options;
  }

  enter(): void {
    const view = deriveScorecard(this.options.round);
    const { root, actions } = this.options;

    const buttons = el("div", { class: "results__actions" });
    const mainMenu = el("button", {
      class: "btn",
      type: "button",
      text: "MAIN MENU",
    });
    this.teardown.push(on(mainMenu, "click", actions.mainMenu));
    buttons.append(mainMenu);

    const next = el("button", {
      class: "btn btn--primary",
      type: "button",
      // A finished round has no next hole; the label says so rather than the button vanishing
      // and shifting the row under the player's cursor.
      text: view.complete ? "ROUND COMPLETE" : "NEXT HOLE",
      disabled: actions.nextHole === undefined || view.complete,
    });
    if (actions.nextHole && !view.complete) this.teardown.push(on(next, "click", actions.nextHole));
    buttons.append(next);

    this.container = el("div", { class: "screen screen--scrim results" }, [
      el("div", { class: "panel results__panel" }, [
        el("div", { class: "results__head" }, [
          el("h1", { class: "results__title", text: "RESULTS" }),
          el("div", { class: "results__score" }, [
            el("span", { class: "results__score-label", text: "FINAL SCORE" }),
            el("span", { class: "results__score-value", text: view.relative }),
          ]),
        ]),
        buildCard(view),
        el("div", { class: "tiles results__tiles" }, view.tiles.map(buildTile)),
        buttons,
      ]),
    ]);
    root.append(this.container);
  }

  step(): void {
    // The round is over; nothing advances behind this screen.
  }

  draw(): void {
    // Keeps the finished course on screen under the scrim rather than a black page.
    this.options.drawBehind?.();
  }

  exit(): void {
    for (const off of this.teardown) off();
    this.teardown.length = 0;
    this.container?.remove();
    this.container = null;
  }
}

function buildCard(view: ScorecardView): HTMLElement {
  // One label column, nine hole columns, one total column.
  const grid = el("div", {
    class: "card-grid results__card",
    style: { "grid-template-columns": `auto repeat(${CARD_COLUMNS}, 1fr) auto` },
  });

  grid.append(el("div", { class: "card-grid__label", text: "HOLE" }));
  for (const hole of view.holes) {
    grid.append(el("div", { class: "card-grid__head", text: hole.label }));
  }
  grid.append(el("div", { class: "card-grid__head", text: "TOTAL" }));

  grid.append(el("div", { class: "card-grid__label", text: "PAR" }));
  for (const hole of view.holes) {
    grid.append(cell(hole.par, null));
  }
  grid.append(cell(view.totalPar, null, "card-grid__cell--total"));

  grid.append(el("div", { class: "card-grid__label", text: "STROKES" }));
  for (const hole of view.holes) {
    grid.append(cell(hole.strokes, hole.result));
  }
  grid.append(cell(view.totalStrokes, null, "card-grid__cell--total"));

  return grid;
}

function cell(text: string, result: string | null, extra = ""): HTMLElement {
  const modifier = text === "" ? "card-grid__cell--empty" : result ? `card-grid__cell--${result}` : "";
  return el("div", { class: `card-grid__cell ${modifier} ${extra}`.trim(), text });
}

function buildTile(tile: { label: string; value: string }): HTMLElement {
  return el("div", { class: "tile" }, [
    el("div", { class: "tile__label", text: tile.label }),
    el("div", { class: "tile__value", text: tile.value }),
  ]);
}
