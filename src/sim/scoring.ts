import { MAX_PLAYERS, NO_KILLER, teamOf } from "./matchConfig";

/**
 * What a player's actions are worth in points. Stage 2 uses these for the hit markers; Stage 8's
 * scoreboard, coins and XP (docs/REVAMP-PLAN.md) build on the same numbers, so a marker never
 * promises more than the results screen pays.
 */

/** Points per health point of damage a player's shot or ram takes off an enemy. */
export const SCORE_PER_DAMAGE = 10;

/** Points for a kill. */
export const SCORE_PER_KILL = 100;


/* ---------------------------------------------------------------------------------------------
 * Stage 8: what a match earned (docs/superpowers/specs/2026-11-28-stage-8-economy-design.md §2).
 * ------------------------------------------------------------------------------------------- */

export const SCORE_PER_ASSIST = 40;
export const SCORE_PER_PICKUP = 15;
export const SCORE_FOR_WIN = 250;

/** How long a hit keeps a claim on the victim's death: 5 s, in ticks (Q1). */
export const ASSIST_WINDOW_TICKS = 5 * 60;

/** No damage on record from that attacker. Far enough back that no window reaches it. */
const NEVER = -1_000_000;

/**
 * Per cart, what it did in the match: enemy kills, assists, damage dealt to enemies and pickups.
 * Written by `Sim` where it pushes the matching events, so the tally and the log cannot disagree.
 * Typed arrays sized `MAX_PLAYERS`, allocated once: nothing in the tick allocates.
 */
export class MatchTally {
  readonly kills = new Int32Array(MAX_PLAYERS);
  readonly assists = new Int32Array(MAX_PLAYERS);
  readonly damage = new Int32Array(MAX_PLAYERS);
  readonly pickups = new Int32Array(MAX_PLAYERS);
  /** `lastHit[victim * MAX_PLAYERS + attacker]`: the tick of attacker's last damage to victim. */
  private readonly lastHit = new Int32Array(MAX_PLAYERS * MAX_PLAYERS).fill(NEVER);

  /** Damage dealt. Only an enemy's counts: friendly fire and self-damage score nothing. */
  damaged(attacker: number, victim: number, amount: number, tick: number): void {
    if (!valid(attacker) || !valid(victim) || amount <= 0) return;
    if (teamOf(attacker) === teamOf(victim)) return;
    this.damage[attacker] += amount;
    this.lastHit[victim * MAX_PLAYERS + attacker] = tick;
  }

  /**
   * A death. An enemy kill counts for the killer. Every other cart on the killer's side (or, for a
   * death nobody caused, every enemy of the victim) that damaged the victim inside the window gets
   * an assist. The victim's slate is wiped either way, so a later death owes nothing to this life.
   */
  killed(killer: number, victim: number, tick: number): void {
    if (!valid(victim)) return;
    const hasKiller = killer !== NO_KILLER && valid(killer) && teamOf(killer) !== teamOf(victim);
    if (hasKiller) this.kills[killer] += 1;
    const row = victim * MAX_PLAYERS;
    for (let a = 0; a < MAX_PLAYERS; a++) {
      const at = this.lastHit[row + a]!;
      this.lastHit[row + a] = NEVER;
      if (a === killer || tick - at > ASSIST_WINDOW_TICKS) continue;
      // `damaged` only records enemies of the victim, so every attacker here is one.
      this.assists[a] += 1;
    }
  }

  pickedUp(cart: number): void {
    if (valid(cart)) this.pickups[cart] += 1;
  }

  reset(): void {
    this.kills.fill(0);
    this.assists.fill(0);
    this.damage.fill(0);
    this.pickups.fill(0);
    this.lastHit.fill(NEVER);
  }
}

function valid(i: number): boolean {
  return i >= 0 && i < MAX_PLAYERS;
}

export interface Earnings {
  kills: number;
  assists: number;
  damage: number;
  pickups: number;
  won: boolean;
  score: number;
  coins: number;
  xp: number;
}

export function createEarnings(): Earnings {
  return { kills: 0, assists: 0, damage: 0, pickups: 0, won: false, score: 0, coins: 0, xp: 0 };
}

/**
 * One cart's earnings: `score = 100·kills + 40·assists + 10·damage + 15·pickups + 250·won`, coins
 * half of it rounded down, XP all of it. `winningTeam` is `Match.winningTeam()`; a draw (or a match
 * still running) wins nothing (Q2).
 */
export function matchEarnings(tally: MatchTally, winningTeam: number, cart: number, out: Earnings): Earnings {
  out.kills = tally.kills[cart] ?? 0;
  out.assists = tally.assists[cart] ?? 0;
  out.damage = tally.damage[cart] ?? 0;
  out.pickups = tally.pickups[cart] ?? 0;
  out.won = winningTeam >= 0 && winningTeam === teamOf(cart);
  out.score =
    SCORE_PER_KILL * out.kills +
    SCORE_PER_ASSIST * out.assists +
    SCORE_PER_DAMAGE * out.damage +
    SCORE_PER_PICKUP * out.pickups +
    (out.won ? SCORE_FOR_WIN : 0);
  out.coins = Math.floor(out.score / 2);
  out.xp = out.score;
  return out;
}

/** XP from `level` to `level + 1`. Levels start at 1. */
export function xpToNext(level: number): number {
  return 500 + 250 * level;
}

/** `xp` into `level`, plus `gained`: the new level and the XP into it, over any number of level-ups. */
export function addXp(level: number, xp: number, gained: number): { level: number; xp: number } {
  let l = Math.max(1, Math.floor(level));
  let x = Math.max(0, xp) + Math.max(0, gained);
  while (x >= xpToNext(l)) {
    x -= xpToNext(l);
    l += 1;
  }
  return { level: l, xp: x };
}
