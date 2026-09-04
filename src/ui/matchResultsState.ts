import type { MatchOutcome } from "../sim/world";

/**
 * The DOM-free half of the results overlay, split from the writing half for the same reason
 * `hudState.ts` is: the rules below -- when it shows, what it says -- get asserted in Vitest's
 * node environment instead of eyeballed in a browser.
 *
 * Reads only. Per AGENTS.md, `src/ui/**` is a pure consumer of sim state.
 */

/** The structural slice of `Sim` this module needs. Structural so tests need no Rapier world. */
export interface MatchResultsSource {
  readonly matchOver: boolean;
  readonly cart: { readonly strokesTaken: number };
  readonly bots: readonly { readonly strokesTaken: number }[];
  matchOutcome(): MatchOutcome;
}

export interface MatchResultsState {
  visible: boolean;
  headline: string;
  playerText: string;
  botText: string;
}

/** A blank scratch object for a caller to hold and pass repeatedly as `out`. */
export function createMatchResultsScratch(): MatchResultsState {
  return { visible: false, headline: "", playerText: "", botText: "" };
}

/**
 * Writes into `out` rather than allocating: `main.ts` calls this from the render callback, which
 * the no-per-frame-allocation rule covers just as it covers the fixed step.
 *
 * The bot's score is the best of them, which is the same number `Sim.matchOutcome` compares the
 * player against -- one rule, stated once, so the headline and the numbers under it cannot
 * disagree.
 */
export function deriveMatchResults(source: MatchResultsSource, out: MatchResultsState): void {
  out.visible = source.matchOver;
  out.headline = HEADLINES[source.matchOutcome()];
  out.playerText = `YOU ${source.cart.strokesTaken}`;

  let bestBot = Number.POSITIVE_INFINITY;
  for (const bot of source.bots) bestBot = Math.min(bestBot, bot.strokesTaken);
  out.botText = Number.isFinite(bestBot) ? `BOT ${bestBot}` : "BOT —";
}

const HEADLINES: Readonly<Record<MatchOutcome, string>> = {
  pending: "",
  player: "YOU WIN",
  bot: "BOT WINS",
  draw: "DRAW",
};
