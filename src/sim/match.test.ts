import { describe, expect, it } from "vitest";
import { Match } from "./match";
import { NO_KILLER, teamOf } from "./matchConfig";

/**
 * The scoreboard, on its own. No Rapier, no `Sim` -- `Match` owns numbers and rules and nothing
 * else, which is what lets the rules below be asserted rather than played.
 *
 * Every roster here is deliberately small and the teams are named by index, because `teamOf`
 * alternates: 0 and 2 are team 0, 1 and 3 are team 1. A test that asserted on "the player's
 * team" without pinning which indices that is would pass under either split rule.
 */

const FOUR = { playerCount: 4, durationS: 10 };

/** 1/60, the fixed step. Named so a reader can see the clock tests are counting real ticks. */
const DT = 1 / 60;

describe("Match scoring", () => {
  it("gives an enemy kill one point to the killer and one stroke to the victim's team", () => {
    const match = new Match(FOUR);
    // 0 is team 0, 1 is team 1. Opposite sides.
    expect(teamOf(0)).not.toBe(teamOf(1));
    match.scoreKill(0, 1);

    expect(match.pointsFor(0)).toBe(1);
    expect(match.strokesFor(1)).toBe(1);
    expect(match.teamStrokes(teamOf(1))).toBe(1);
    expect(match.teamStrokes(teamOf(0))).toBe(0);
  });

  it("gives a team kill the stroke and no point", () => {
    const match = new Match(FOUR);
    // 0 and 2 are both team 0.
    expect(teamOf(0)).toBe(teamOf(2));
    match.scoreKill(0, 2);

    // The stroke still lands: the team lost a life however it happened.
    expect(match.strokesFor(2)).toBe(1);
    expect(match.teamStrokes(teamOf(0))).toBe(1);
    // And nobody is rewarded for it. This is the assertion that is red against an unconditional
    // `points[killer] += 1`, which is the obvious way to write scoreKill.
    expect(match.pointsFor(0)).toBe(0);
  });

  it("gives an unattributed death the stroke and no point to anybody", () => {
    const match = new Match(FOUR);
    match.scoreKill(NO_KILLER, 3);

    expect(match.strokesFor(3)).toBe(1);
    expect(match.teamStrokes(teamOf(3))).toBe(1);
    // Nobody scored. Summed across the roster rather than checked at one index, because
    // `points[NO_KILLER]` on a plain array writes a property nobody would ever look at.
    let total = 0;
    for (let i = 0; i < 4; i++) total += match.pointsFor(i);
    expect(total).toBe(0);
  });

  it("counts a player the roster grew to include", () => {
    // `Sim` builds its Match before its bots exist and calls `setRoster` afterwards. A match
    // left at its construction count would drop every bot's deaths out of the team total --
    // which, with the player on team 0 and bot 1 on team 1, means team 1 always wins on zero.
    const match = new Match({ playerCount: 1, durationS: 10 });
    match.scoreKill(0, 1);
    expect(match.teamStrokes(teamOf(1))).toBe(0);

    match.setRoster(2);
    expect(match.teamStrokes(teamOf(1))).toBe(1);
  });

  it("counts each team's strokes separately", () => {
    const match = new Match(FOUR);
    // Team 1 loses twice (indices 1 and 3), team 0 once (index 2). Both sides score, and the
    // totals differ -- a test where one team has none is satisfied by summing everything.
    match.scoreKill(0, 1);
    match.scoreKill(0, 3);
    match.scoreKill(1, 2);

    expect(match.teamStrokes(0)).toBe(1);
    expect(match.teamStrokes(1)).toBe(2);
  });
});

describe("Match winner", () => {
  it("is the team with the fewest strokes", () => {
    const match = new Match(FOUR);
    // Team 0 dies three times, team 1 once. Fewest wins, so team 1.
    match.scoreKill(1, 0);
    match.scoreKill(1, 2);
    match.scoreKill(1, 0);
    match.scoreKill(0, 1);
    match.finish();

    // Named, not derived: this is what is red against a most-strokes-wins comparison, which
    // would answer 0.
    expect(match.winningTeam()).toBe(1);
  });

  it("calls an equal stroke count a draw rather than picking a side", () => {
    const match = new Match(FOUR);
    match.scoreKill(1, 0);
    match.scoreKill(0, 1);
    match.finish();

    expect(match.winningTeam()).toBe(-1);
  });
});

describe("Match MVP", () => {
  it("is the player with the most points", () => {
    const match = new Match(FOUR);
    match.scoreKill(1, 0);
    match.scoreKill(1, 2);
    match.scoreKill(0, 1);

    expect(match.mvp()).toBe(1);
    expect(match.pointsFor(1)).toBe(2);
  });

  it("breaks a tie toward the lower index", () => {
    const match = new Match(FOUR);
    // 0 and 2 both kill once, and 2 comes later in the scan. Red against `>=` in the
    // comparison, which would keep overwriting and answer 2.
    match.scoreKill(0, 1);
    match.scoreKill(2, 3);

    expect(match.pointsFor(0)).toBe(match.pointsFor(2));
    expect(match.mvp()).toBe(0);
  });

  it("names a leader in a match where nobody scored", () => {
    // A scoreboard has to render something. Zero kills across the board is a real state and
    // `null` would push the branch into every consumer.
    const match = new Match(FOUR);
    expect(match.mvp()).toBe(0);
    expect(match.pointsFor(match.mvp())).toBe(0);
  });
});

describe("Match clock", () => {
  it("ends on the tick that brings the clock to zero, not the one after", () => {
    // Five ticks exactly. Repeated subtraction of 1/60 leaves a float residue -- 5/60 minus five
    // sixtieths is 6.9e-18, not 0 -- so this is red against an exact `remaining <= 0`, which
    // never fires and runs the clock a tick long.
    const match = new Match({ playerCount: 2, durationS: 5 * DT });

    for (let i = 0; i < 4; i++) match.tick(DT);
    expect(match.over).toBe(false);

    match.tick(DT);
    expect(match.over).toBe(true);
    expect(match.remaining).toBe(0);
  });

  it("stops counting once it is over", () => {
    const match = new Match({ playerCount: 2, durationS: 5 * DT });
    for (let i = 0; i < 10; i++) match.tick(DT);

    expect(match.remaining).toBe(0);
  });

  it("reports no winner while it is still running", () => {
    const match = new Match(FOUR);
    match.scoreKill(1, 0);

    expect(match.over).toBe(false);
    // -2, not -1: a draw is a real answer at the end and "not finished" is not one, so they
    // cannot share a value or a caller cannot tell them apart.
    expect(match.winningTeam()).toBe(-2);
  });

  it("puts the clock and the whole scoreboard back on reset", () => {
    const match = new Match(FOUR);
    match.scoreKill(0, 1);
    for (let i = 0; i < 4; i++) match.tick(DT);
    match.reset();

    expect(match.remaining).toBe(FOUR.durationS);
    expect(match.over).toBe(false);
    expect(match.pointsFor(0)).toBe(0);
    expect(match.strokesFor(1)).toBe(0);
    expect(match.teamStrokes(1)).toBe(0);
  });
});
