import { NO_RIG } from "../sim/events";
import { teamOf } from "../sim/matchConfig";
import { nameOf } from "./matchScoreboard";

/**
 * The kill feed: who killed whom, top right, newest first, each line gone after a few seconds.
 * Fed from `Sim.events` `kill` events by `MatchScreen`, which owns the cursor.
 *
 * DOM-free so it can be tested in the node environment; `drawKillFeed` is the only part that
 * touches the page, and it rebuilds the list only when `version` has moved.
 */

export const KILL_FEED_LINES = 5;
export const KILL_FEED_TTL_S = 5;

/** Whose side the killer is on, as the player sees it; `none` for a death nobody caused. */
export type FeedSide = "ally" | "enemy" | "none";

export interface KillFeedLine {
  readonly text: string;
  readonly side: FeedSide;
  /** The player is the killer or the victim: the line is drawn stronger. */
  readonly involvesPlayer: boolean;
  age: number;
}

const PLAYER = 0;

export class KillFeed {
  /** Newest first. */
  readonly lines: KillFeedLine[] = [];
  /** Bumped whenever a line arrives or leaves. */
  version = 0;

  onKill(killer: number, victim: number): void {
    const text = killer === NO_RIG ? `${nameOf(victim)} DROWNED` : `${nameOf(killer)} ▸ ${nameOf(victim)}`;
    const side: FeedSide = killer === NO_RIG ? "none" : teamOf(killer) === teamOf(PLAYER) ? "ally" : "enemy";
    this.lines.unshift({ text, side, involvesPlayer: killer === PLAYER || victim === PLAYER, age: 0 });
    if (this.lines.length > KILL_FEED_LINES) this.lines.length = KILL_FEED_LINES;
    this.version++;
  }

  /** Ages every line by `dt` seconds and drops the expired ones. */
  update(dt: number): void {
    for (const line of this.lines) line.age += dt;
    const before = this.lines.length;
    while (this.lines.length > 0 && this.lines[this.lines.length - 1]!.age >= KILL_FEED_TTL_S) this.lines.pop();
    if (this.lines.length !== before) this.version++;
  }

  clear(): void {
    if (this.lines.length === 0) return;
    this.lines.length = 0;
    this.version++;
  }
}

/** Writes the feed into `root` when it has changed since `drawnVersion`; returns the version drawn. */
export function drawKillFeed(root: HTMLElement, feed: KillFeed, drawnVersion: number): number {
  if (feed.version === drawnVersion) return drawnVersion;
  root.replaceChildren(
    ...feed.lines.map((line) => {
      const node = document.createElement("div");
      node.className = `kill-feed__line kill-feed__line--${line.side}${line.involvesPlayer ? " kill-feed__line--you" : ""}`;
      node.textContent = line.text;
      return node;
    }),
  );
  return feed.version;
}
