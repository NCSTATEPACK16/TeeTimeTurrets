import { describe, expect, it } from "vitest";
import { KILL_FEED_LINES, KILL_FEED_TTL_S, KillFeed } from "./killFeed";
import { NO_RIG } from "../sim/events";

describe("KillFeed", () => {
  it("names the killer and the victim, newest first", () => {
    const feed = new KillFeed();
    feed.onKill(1, 2);
    feed.onKill(0, 3);
    expect(feed.lines.map((l) => l.text)).toEqual(["YOU ▸ BOT 3", "BOT 1 ▸ BOT 2"]);
  });

  it("says a cart drowned when nobody killed it", () => {
    const feed = new KillFeed();
    feed.onKill(NO_RIG, 4);
    expect(feed.lines[0]!.text).toBe("BOT 4 DROWNED");
  });

  it("colours a line by the killer's side as the player sees it", () => {
    const feed = new KillFeed();
    feed.onKill(2, 1); // rig 2 is on the player's team (rigs alternate teams)
    feed.onKill(1, 0);
    feed.onKill(NO_RIG, 3);
    expect(feed.lines.map((l) => l.side)).toEqual(["none", "enemy", "ally"]);
  });

  it("marks a line the player is in, either end", () => {
    const feed = new KillFeed();
    feed.onKill(1, 3);
    feed.onKill(1, 0);
    feed.onKill(0, 1);
    expect(feed.lines.map((l) => l.involvesPlayer)).toEqual([true, true, false]);
  });

  it(`keeps at most ${KILL_FEED_LINES} lines, dropping the oldest`, () => {
    const feed = new KillFeed();
    for (let v = 1; v <= KILL_FEED_LINES + 2; v++) feed.onKill(0, v);
    expect(feed.lines).toHaveLength(KILL_FEED_LINES);
    expect(feed.lines[0]!.text).toBe(`YOU ▸ BOT ${KILL_FEED_LINES + 2}`);
  });

  it(`lets a line go after ${KILL_FEED_TTL_S} s, and bumps its version when it changes`, () => {
    const feed = new KillFeed();
    const v0 = feed.version;
    feed.onKill(1, 2);
    expect(feed.version).toBeGreaterThan(v0);
    const v1 = feed.version;
    feed.update(KILL_FEED_TTL_S - 0.1);
    expect(feed.lines).toHaveLength(1);
    expect(feed.version).toBe(v1); // nothing left or arrived: a renderer can skip the DOM
    feed.update(0.2);
    expect(feed.lines).toHaveLength(0);
    expect(feed.version).toBeGreaterThan(v1);
  });

  it("clears for a rematch", () => {
    const feed = new KillFeed();
    feed.onKill(1, 2);
    feed.clear();
    expect(feed.lines).toHaveLength(0);
  });
});
