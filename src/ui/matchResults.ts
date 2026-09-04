import { createMatchResultsScratch, deriveMatchResults } from "./matchResultsState";
import type { MatchResultsSource } from "./matchResultsState";

/**
 * The DOM-writing half of the results overlay. Every decision lives in `matchResultsState.ts`;
 * this file only puts strings into elements and toggles one `hidden` flag -- the same split
 * `hud.ts`/`hudState.ts` already established, which is why this file has no tests and
 * `npm run smoke` is what notices an element wired to nothing.
 *
 * Deliberately not Phase 1.75's `ScreenManager`: no enter/exit lifecycle, no scene residency,
 * no second screen to register. One overlay, one boolean -- the smallest thing that gives a
 * match a real ending instead of a freeze.
 */

const stateScratch = createMatchResultsScratch();

export interface MatchResultsDom {
  root: HTMLElement;
  headline: HTMLElement;
  playerScore: HTMLElement;
  botScore: HTMLElement;
  playAgain: HTMLElement;
}

export function readMatchResults(): MatchResultsDom | null {
  const ids = ["match-results", "results-headline", "results-you", "results-bot", "play-again"] as const;
  const found = ids.map((id) => document.getElementById(id));
  if (found.some((element) => element === null)) return null;
  const [root, headline, playerScore, botScore, playAgain] = found as HTMLElement[];
  return {
    root: root!,
    headline: headline!,
    playerScore: playerScore!,
    botScore: botScore!,
    playAgain: playAgain!,
  };
}

export function drawMatchResults(dom: MatchResultsDom, source: MatchResultsSource): void {
  const state = stateScratch;
  deriveMatchResults(source, state);

  if (dom.root.hidden === state.visible) dom.root.hidden = !state.visible;
  if (!state.visible) return;

  setText(dom.headline, state.headline);
  setText(dom.playerScore, state.playerText);
  setText(dom.botScore, state.botText);
}

/** Guarded so an unchanged string does not dirty the DOM every frame at 60fps. */
function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}
