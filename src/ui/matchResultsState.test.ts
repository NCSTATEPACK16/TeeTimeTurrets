import { describe, expect, it } from "vitest";
import {
  createMatchResultsScratch,
  deriveMatchResults,
} from "./matchResultsState";
import type { MatchResultsSource, MatchResultsState } from "./matchResultsState";

// bestBotStrokes is a function on the source (mirroring Sim.bestBotStrokes) rather than a `bots`
// array here: the "lowest bot score" rule now lives once, in Sim, and this module only displays
// what it's told -- see the review finding this replaced (a second copy of the min-over-bots
// loop, which could disagree with Sim.matchOutcome's).
function source(overrides: Partial<MatchResultsSource> = {}): MatchResultsSource {
  return {
    matchOver: true,
    cart: { strokesTaken: 2 },
    bestBotStrokes: () => 5,
    matchOutcome: () => "player",
    ...overrides,
  };
}

function derive(src: MatchResultsSource): MatchResultsState {
  const out = createMatchResultsScratch();
  deriveMatchResults(src, out);
  return out;
}

describe("deriveMatchResults", () => {
  it("stays hidden while the match is still running", () => {
    const state = derive(source({ matchOver: false, matchOutcome: () => "pending" }));
    expect(state.visible).toBe(false);
  });

  it("announces a player win with both stroke counts", () => {
    const state = derive(source());
    expect(state.visible).toBe(true);
    expect(state.headline).toBe("YOU WIN");
    expect(state.playerText).toBe("YOU 2");
    expect(state.botText).toBe("BOT 5");
  });

  it("announces a bot win", () => {
    const state = derive(
      source({ cart: { strokesTaken: 6 }, bestBotStrokes: () => 1, matchOutcome: () => "bot" }),
    );
    expect(state.headline).toBe("BOT WINS");
  });

  it("announces a draw", () => {
    const state = derive(
      source({ cart: { strokesTaken: 3 }, bestBotStrokes: () => 3, matchOutcome: () => "draw" }),
    );
    expect(state.headline).toBe("DRAW");
  });

  it("displays whatever bestBotStrokes() reports, rather than recomputing it", () => {
    const state = derive(source({ bestBotStrokes: () => 4 }));
    expect(state.botText).toBe("BOT 4");
  });

  it("reads a dash when bestBotStrokes() reports no bot (Infinity)", () => {
    const state = derive(source({ bestBotStrokes: () => Number.POSITIVE_INFINITY }));
    expect(state.botText).toBe("BOT —");
  });

  it("writes into the caller's object rather than allocating", () => {
    const out = createMatchResultsScratch();
    deriveMatchResults(source(), out);
    const first = out;
    deriveMatchResults(source({ matchOutcome: () => "draw" }), out);
    expect(out).toBe(first);
    expect(out.headline).toBe("DRAW");
  });
});
