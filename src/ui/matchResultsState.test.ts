import { describe, expect, it } from "vitest";
import {
  createMatchResultsScratch,
  deriveMatchResults,
} from "./matchResultsState";
import type { MatchResultsSource, MatchResultsState } from "./matchResultsState";

function source(overrides: Partial<MatchResultsSource> = {}): MatchResultsSource {
  return {
    matchOver: true,
    cart: { strokesTaken: 2 },
    bots: [{ strokesTaken: 5 }],
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
      source({ cart: { strokesTaken: 6 }, bots: [{ strokesTaken: 1 }], matchOutcome: () => "bot" }),
    );
    expect(state.headline).toBe("BOT WINS");
  });

  it("announces a draw", () => {
    const state = derive(
      source({ cart: { strokesTaken: 3 }, bots: [{ strokesTaken: 3 }], matchOutcome: () => "draw" }),
    );
    expect(state.headline).toBe("DRAW");
  });

  it("reports the best bot score when there is more than one", () => {
    const state = derive(source({ bots: [{ strokesTaken: 7 }, { strokesTaken: 4 }] }));
    expect(state.botText).toBe("BOT 4");
  });

  it("reads a dash for the bot score when there is no bot", () => {
    const state = derive(source({ bots: [] }));
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
