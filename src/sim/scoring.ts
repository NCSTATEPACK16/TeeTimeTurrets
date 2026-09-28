/**
 * What a match is worth, per `docs/REVAMP-PLAN.md` Stage 8. The per-event values live here from
 * Stage 2 on, because a hit marker shows them: a `+10` floating over a cart and the score on the
 * results screen must be one number, not two copies that can drift.
 */

/** Points for each point of health a player's shot takes off an enemy. */
export const POINTS_PER_DAMAGE = 10;
/** Points for a kill. */
export const POINTS_PER_KILL = 100;
/** Points for a kill another player on the team finished within `ASSIST_WINDOW_S` of this hit. */
export const POINTS_PER_ASSIST = 40;
export const POINTS_PER_PICKUP = 15;
export const POINTS_FOR_WIN = 250;
/** Seconds a hit counts toward an assist on the kill that follows it. */
export const ASSIST_WINDOW_S = 5;

/** What the player did in one match: the inputs to the score. */
export interface MatchTally {
  kills: number;
  assists: number;
  /** Health taken off enemies by the player's shots. */
  damage: number;
  /** Buckets and landed balls collected. */
  pickups: number;
}

export interface MatchOutcome extends Readonly<MatchTally> {
  readonly won: boolean;
}

export function createTally(): MatchTally {
  return { kills: 0, assists: 0, damage: 0, pickups: 0 };
}

export function matchScore(o: MatchOutcome): number {
  return (
    POINTS_PER_KILL * o.kills +
    POINTS_PER_ASSIST * o.assists +
    POINTS_PER_DAMAGE * o.damage +
    POINTS_PER_PICKUP * o.pickups +
    (o.won ? POINTS_FOR_WIN : 0)
  );
}

/** Coins a score pays: half of it. XP is the score itself. */
export function coinsFor(score: number): number {
  return Math.floor(score / 2);
}

/** XP from `level` to the next. */
export function xpToNext(level: number): number {
  return 500 + 250 * level;
}

export interface Progress {
  readonly level: number;
  /** XP into the current level. */
  readonly xp: number;
}

/** `progress` after gaining `xp`, carried over across as many levels as it pays for. */
export function addXp(progress: Progress, xp: number): Progress & { readonly levelsGained: number } {
  let level = progress.level;
  let into = progress.xp + xp;
  let levelsGained = 0;
  while (into >= xpToNext(level)) {
    into -= xpToNext(level);
    level++;
    levelsGained++;
  }
  return { level, xp: into, levelsGained };
}
