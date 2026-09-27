import { describe, expect, it } from "vitest";
import { NO_KILLER } from "../sim/matchConfig";
import { KILL_FEED_LINES, KILL_FEED_SECONDS, KillFeed, rigName } from "./killFeed";

describe("rigName", () => {
  it("calls the player YOU and a bot by its number, the way the nameplates do", () => {
    expect(rigName(0)).toBe("YOU");
    expect(rigName(3)).toBe("BOT 3");
  });
});

describe("KillFeed", () => {
  it("names the killer and the victim, and whose side each is on", () => {
    const feed = new KillFeed();
    feed.push(1, 0); // bot 1 is an enemy (odd rigs), and killed the player
    expect(feed.lines).toEqual([
      { killer: "BOT 1", killerSide: "enemy", victim: "YOU", victimSide: "self", age: 0 },
    ]);
  });

  it("names a death nobody caused by what did it", () => {
    const feed = new KillFeed();
    feed.push(NO_KILLER, 2);
    expect(feed.lines[0]).toMatchObject({ killer: null, victim: "BOT 2", victimSide: "ally" });
  });

  it("puts the newest on top and keeps only the last few", () => {
    const feed = new KillFeed();
    for (let victim = 1; victim <= KILL_FEED_LINES + 2; victim++) feed.push(0, victim);
    expect(feed.lines).toHaveLength(KILL_FEED_LINES);
    expect(feed.lines.map((l) => l.victim)).toEqual(["BOT 6", "BOT 5", "BOT 4", "BOT 3"]);
  });

  it("lets a line go once it has been up long enough", () => {
    const feed = new KillFeed();
    feed.push(0, 1);
    feed.update(KILL_FEED_SECONDS - 0.01);
    feed.push(0, 3);
    expect(feed.lines).toHaveLength(2);
    feed.update(0.02);
    expect(feed.lines.map((l) => l.victim)).toEqual(["BOT 3"]);
  });
});
