import { describe, expect, it } from "vitest";
import { Match } from "../sim/match";
import { deriveScoreboard } from "./matchScoreboard";

/**
 * The rules the results screen renders, asserted against a real `Match` rather than a hand-made
 * source object. `Match` is DOM-free and cheap, so there is nothing to fake -- and a fake would
 * let this file and the sim disagree about what a draw is.
 */

/** Four players: 0 and 2 on team 0 with the human, 1 and 3 on team 1. */
function match(): Match {
  return new Match({ playerCount: 4, durationS: 10 });
}

describe("the results scoreboard", () => {
  it("says nothing while the match is still running", () => {
    const m = match();
    m.scoreKill(0, 1);
    const state = deriveScoreboard(m);

    expect(state.headline).toBe("");
    expect(state.rows).toHaveLength(4);
  });

  it("names the player's side when it has the fewest strokes", () => {
    const m = match();
    // Team 1 dies twice, team 0 once. Fewest wins.
    m.scoreKill(0, 1);
    m.scoreKill(0, 3);
    m.scoreKill(1, 2);
    m.finish();

    const state = deriveScoreboard(m);
    expect(state.headline).toBe("YOUR TEAM WINS");
    // Named separately and different from each other: a scoreboard that read one team twice is
    // invisible against a tie, which is exactly the state this pair is meant to distinguish.
    expect(state.usText).toBe("US 1");
    expect(state.themText).toBe("THEM 2");
  });

  it("names the other side when it has the fewest", () => {
    const m = match();
    m.scoreKill(1, 0);
    m.scoreKill(1, 2);
    m.scoreKill(0, 1);
    m.finish();

    expect(deriveScoreboard(m).headline).toBe("ENEMY TEAM WINS");
  });

  it("calls a level match a draw", () => {
    const m = match();
    m.scoreKill(0, 1);
    m.scoreKill(1, 0);
    m.finish();

    expect(deriveScoreboard(m).headline).toBe("DRAW");
  });

  it("names the MVP and their kills", () => {
    const m = match();
    m.scoreKill(1, 0);
    m.scoreKill(1, 2);
    m.scoreKill(0, 1);
    m.finish();

    // Rig 1 is the first bot, and the nameplates call that one "BOT 1". Two kills against the
    // player's one, so the badge crosses sides -- which is the design, not an oversight: the
    // team wins by not dying and the badge goes to whoever kills most.
    const state = deriveScoreboard(m);
    expect(state.mvpText).toBe("MVP  BOT 1 — 2 KILLS");
    expect(state.headline).toBe("ENEMY TEAM WINS");
  });

  it("says one kill rather than one kills", () => {
    const m = match();
    m.scoreKill(0, 1);
    m.finish();
    expect(deriveScoreboard(m).mvpText).toBe("MVP  YOU — 1 KILL");
  });

  it("still names an MVP when nobody scored", () => {
    const m = match();
    m.finish();
    expect(deriveScoreboard(m).mvpText).toBe("MVP  YOU — 0 KILLS");
  });

  it("lists every player with their own side, kills and deaths", () => {
    const m = match();
    m.scoreKill(1, 0);
    m.scoreKill(1, 0);
    m.scoreKill(0, 3);
    m.finish();

    const rows = deriveScoreboard(m).rows;
    expect(rows.map((r) => r.name)).toEqual(["YOU", "BOT 1", "BOT 2", "BOT 3"]);
    // The human died twice and killed once; bot 1 killed twice and died none. Asserted per row
    // rather than as totals: a scoreboard that credited every kill to one row would still sum
    // correctly.
    expect(rows[0]).toEqual({ name: "YOU", team: 0, points: 1, strokes: 2 });
    expect(rows[1]).toEqual({ name: "BOT 1", team: 1, points: 2, strokes: 0 });
    expect(rows[3]).toEqual({ name: "BOT 3", team: 1, points: 0, strokes: 1 });
  });

  it("lists only the roster it was given", () => {
    const m = new Match({ playerCount: 2, durationS: 10 });
    m.finish();
    // `Match` allocates for 24 and scores over `playerCount`. A scoreboard that iterated the
    // array length would print twenty-two empty rows.
    expect(deriveScoreboard(m).rows).toHaveLength(2);
  });
});
