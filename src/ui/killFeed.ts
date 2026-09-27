import { NO_KILLER, teamOf } from "../sim/matchConfig";

/**
 * The kill feed: who killed whom, newest on top, each line up for a few seconds. DOM-free, so the
 * rules are tested; `killFeedDom.ts` writes it. Fed from `Sim.events`' `kill` records by the match
 * screen, which is why it takes rig indices and names them itself.
 */

/** Lines shown at once. More than this in a few seconds is a wipe, and the oldest can go. */
export const KILL_FEED_LINES = 4;
/** Seconds a line stays up. */
export const KILL_FEED_SECONDS = 5;

/** A rig relative to the player: the player, a teammate, or an opponent. */
export type FeedSide = "self" | "ally" | "enemy";

export interface KillFeedLine {
  /** Null for a death nobody caused -- a drowning, today. */
  killer: string | null;
  killerSide: FeedSide | null;
  victim: string;
  victimSide: FeedSide;
  /** Seconds since it happened. */
  age: number;
}

/** What the HUD calls rig `index`: the same names the nameplates use. */
export function rigName(index: number): string {
  return index === 0 ? "YOU" : `BOT ${index}`;
}

function sideOf(index: number): FeedSide {
  if (index === 0) return "self";
  return teamOf(index) === teamOf(0) ? "ally" : "enemy";
}

export class KillFeed {
  /** Newest first. Read-only to callers; `push` and `update` are the only writers. */
  readonly lines: KillFeedLine[] = [];

  push(killer: number, victim: number): void {
    const known = killer !== NO_KILLER && killer >= 0;
    this.lines.unshift({
      killer: known ? rigName(killer) : null,
      killerSide: known ? sideOf(killer) : null,
      victim: rigName(victim),
      victimSide: sideOf(victim),
      age: 0,
    });
    if (this.lines.length > KILL_FEED_LINES) this.lines.length = KILL_FEED_LINES;
  }

  update(dt: number): void {
    for (const line of this.lines) line.age += dt;
    while (this.lines.length > 0 && this.lines[this.lines.length - 1]!.age >= KILL_FEED_SECONDS) this.lines.pop();
  }
}
