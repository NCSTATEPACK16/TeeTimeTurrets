import { describe, expect, it } from "vitest";
import { deriveScorecard, formatRelative } from "./scorecard";
import { Round } from "../../sim/round";

/**
 * The view model behind image 13. DOM-free so it runs in vitest's node environment, which is the
 * same split `hudState.ts` / `hud.ts` uses and the reason those are testable at all.
 *
 * The load-bearing requirement is that the card ships NINE columns with one hole live: the layout
 * is the expensive part, and multi-hole then fills columns without the screen being touched. So
 * a one-hole round must still produce nine columns, eight of them empty.
 */

const NINE = [4, 3, 5, 4, 4, 3, 4, 5, 4];

describe("column layout", () => {
  it("always emits nine hole columns plus a total, even with one hole live", () => {
    const view = deriveScorecard(new Round([4]));
    expect(view.holes).toHaveLength(9);
    expect(view.holes.filter((h) => h.strokes === "").length).toBe(9);
  });

  it("numbers the columns 1..9 for a human, not 0-based", () => {
    expect(deriveScorecard(new Round(NINE)).holes.map((h) => h.label)).toEqual([
      "1", "2", "3", "4", "5", "6", "7", "8", "9",
    ]);
  });

  it("leaves par blank on columns past the end of a short round", () => {
    const view = deriveScorecard(new Round([4, 3]));
    expect(view.holes[0]?.par).toBe("4");
    expect(view.holes[2]?.par).toBe("");
  });

  it("shows par and strokes for holes that have been played", () => {
    const round = new Round(NINE);
    round.completeHole(5);
    round.completeHole(3);
    const view = deriveScorecard(round);
    expect(view.holes[0]).toMatchObject({ par: "4", strokes: "5", result: "over" });
    expect(view.holes[1]).toMatchObject({ par: "3", strokes: "3", result: "level" });
    expect(view.holes[2]).toMatchObject({ strokes: "", result: null });
  });
});

describe("totals", () => {
  it("totals par over the whole course and strokes over what was played", () => {
    const round = new Round(NINE);
    round.completeHole(5);
    const view = deriveScorecard(round);
    expect(view.totalPar).toBe("36");
    expect(view.totalStrokes).toBe("5");
  });

  it("totals only the columns on the card, so the PAR row adds up to its own TOTAL", () => {
    // An 18-hole course under a nine-column card: printing all eighteen holes' par beside nine
    // visible numbers gives a row that plainly does not sum to its own total.
    const eighteen = [...NINE, ...NINE];
    const view = deriveScorecard(new Round(eighteen));
    const shown = view.holes.reduce((sum, h) => sum + Number(h.par || 0), 0);
    expect(view.totalPar).toBe(String(shown));
    expect(view.totalPar).toBe("36");
  });

  it("signs the score against par the way a card does", () => {
    expect(formatRelative(0)).toBe("E");
    expect(formatRelative(-3)).toBe("-3");
    expect(formatRelative(2)).toBe("+2");
  });

  it("reports level par as E rather than +0", () => {
    const round = new Round([4]);
    round.completeHole(4);
    expect(deriveScorecard(round).relative).toBe("E");
  });
});

describe("the four stat tiles", () => {
  it("labels them as image 13 does", () => {
    expect(deriveScorecard(new Round(NINE)).tiles.map((t) => t.label)).toEqual([
      "DIRECT HITS",
      "LONGEST DRIVE",
      "TARGETS DOWN",
      "ACCURACY",
    ]);
  });

  it("reads zeros before anything happens rather than blanks", () => {
    expect(deriveScorecard(new Round(NINE)).tiles.map((t) => t.value)).toEqual([
      "0",
      "0 m",
      "0",
      "0%",
    ]);
  });

  it("rounds the longest drive to whole metres and accuracy to whole percent", () => {
    const round = new Round(NINE);
    round.recordDrive(84.62);
    round.recordShot();
    round.recordShot();
    round.recordShot();
    round.recordHit();
    const tiles = deriveScorecard(round).tiles;
    expect(tiles[1]?.value).toBe("85 m");
    expect(tiles[3]?.value).toBe("33%");
  });
});

describe("headline", () => {
  it("says the round is still running until every hole is scored", () => {
    const round = new Round([4, 4]);
    round.completeHole(4);
    expect(deriveScorecard(round).complete).toBe(false);
  });

  it("marks the round complete once the last hole is in", () => {
    const round = new Round([4]);
    round.completeHole(4);
    expect(deriveScorecard(round).complete).toBe(true);
  });
});
