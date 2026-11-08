/**
 * Killstreak callouts for the player, derived from `kill` events and nothing else.
 *
 * Two kinds, both golf-scored:
 * - **Multi-kills** inside `MULTI_KILL_WINDOW_S` of each other: BIRDIE (2), EAGLE (3), ALBATROSS (4+).
 * - **Streaks** of kills without dying: ON THE GREEN (3), CLUB CHAMPION (5), GREEN JACKET (8).
 *
 * When one kill earns both, the multi-kill wins: it is the rarer moment. DOM-free; the banner
 * shows what `onKill` returns.
 */

export const MULTI_KILL_WINDOW_S = 4;

export interface StreakCallout {
  readonly headline: string;
  readonly consequence: string;
}

const MULTI: readonly StreakCallout[] = [
  { headline: "BIRDIE!", consequence: "DOUBLE KILL" },
  { headline: "EAGLE!", consequence: "TRIPLE KILL" },
  { headline: "ALBATROSS!", consequence: "QUAD KILL" },
];

const STREAKS: ReadonlyMap<number, StreakCallout> = new Map([
  [3, { headline: "ON THE GREEN", consequence: "3 KILL STREAK" }],
  [5, { headline: "CLUB CHAMPION", consequence: "5 KILL STREAK" }],
  [8, { headline: "GREEN JACKET", consequence: "8 KILL STREAK" }],
]);

export class StreakTracker {
  private lastKillS = -Infinity;
  private multi = 0;
  private streak = 0;

  /** The player made a kill at `timeS` (sim seconds). Returns a callout to show, or null. */
  onKill(timeS: number): StreakCallout | null {
    this.multi = timeS - this.lastKillS <= MULTI_KILL_WINDOW_S ? this.multi + 1 : 1;
    this.lastKillS = timeS;
    this.streak += 1;
    if (this.multi >= 2) return MULTI[Math.min(this.multi, 4) - 2]!;
    return STREAKS.get(this.streak) ?? null;
  }

  /** The player died: the streak and any multi-kill chain are over. */
  onDeath(): void {
    this.streak = 0;
    this.multi = 0;
    this.lastKillS = -Infinity;
  }
}
