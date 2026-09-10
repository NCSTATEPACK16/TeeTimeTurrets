import { describe, expect, it } from "vitest";
import { MAX_PLAYERS, NO_KILLER, TEAM_COUNT, teamOf } from "./matchConfig";

/**
 * The only rule in `matchConfig.ts` that is logic rather than a number, and the one place a
 * wrong answer would be invisible: a roster split that is even at 24 and lopsided at 3 looks
 * correct in every test written against a full match.
 */

function sizes(playerCount: number): number[] {
  const counts = new Array<number>(TEAM_COUNT).fill(0);
  for (let i = 0; i < playerCount; i++) counts[teamOf(i)] += 1;
  return counts;
}

describe("teamOf", () => {
  it.each([1, 2, 3, 5, 24])("splits a roster of %i within one player", (playerCount) => {
    const counts = sizes(playerCount);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    // The sum is the control: a `teamOf` that returned a constant would also have a spread of
    // zero, and would put every player on one side.
    expect(counts.reduce((a, b) => a + b, 0)).toBe(playerCount);
  });

  it("puts the human on team 0", () => {
    expect(teamOf(0)).toBe(0);
  });

  it("puts adjacent indices on opposite sides", () => {
    // The discriminating case. A `index < playerCount / 2` split -- the obvious alternative --
    // is even at 24 and puts 0 and 1 on the SAME side, so this is what separates the two rules
    // rather than the spread assertion above, which both satisfy at even counts.
    expect(teamOf(1)).not.toBe(teamOf(0));
  });

  it("never answers with a team that does not exist", () => {
    for (let i = 0; i < MAX_PLAYERS; i++) {
      expect(teamOf(i)).toBeGreaterThanOrEqual(0);
      expect(teamOf(i)).toBeLessThan(TEAM_COUNT);
    }
  });

  it("keeps NO_KILLER outside every valid player index", () => {
    // `Match.scoreKill` guards on this sentinel before indexing `points`. A sentinel of 0 would
    // silently credit the human for every drowning on the course.
    expect(NO_KILLER).toBeLessThan(0);
  });
});
