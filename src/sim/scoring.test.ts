import { describe, expect, it } from "vitest";
import { addXp, coinsFor, matchScore, xpToNext } from "./scoring";

describe("matchScore", () => {
  it("is 100 a kill, 40 an assist, 10 a point of damage, 15 a pickup and 250 for the win", () => {
    expect(matchScore({ kills: 0, assists: 0, damage: 0, pickups: 0, won: false })).toBe(0);
    expect(matchScore({ kills: 2, assists: 1, damage: 7, pickups: 3, won: true })).toBe(200 + 40 + 70 + 45 + 250);
  });

  it("pays half the score in coins, rounded down, and the whole of it in XP", () => {
    expect(coinsFor(605)).toBe(302);
    expect(coinsFor(0)).toBe(0);
  });
});

describe("levels", () => {
  it("need 500 XP plus 250 a level to go up", () => {
    expect(xpToNext(1)).toBe(750);
    expect(xpToNext(4)).toBe(1500);
  });

  it("carries XP over across as many levels as it pays for", () => {
    expect(addXp({ level: 1, xp: 700 }, 100)).toEqual({ level: 2, xp: 50, levelsGained: 1 });
    expect(addXp({ level: 1, xp: 0 }, 750 + 1000 + 10)).toEqual({ level: 3, xp: 10, levelsGained: 2 });
    expect(addXp({ level: 5, xp: 3 }, 0)).toEqual({ level: 5, xp: 3, levelsGained: 0 });
  });
});
