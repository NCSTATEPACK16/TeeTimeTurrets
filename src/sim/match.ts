import { MAX_PLAYERS, NO_KILLER, TEAM_COUNT, teamOf } from "./matchConfig";

/**
 * The match: a clock and a scoreboard, and nothing that needs a physics world to be true.
 *
 * Split out of `Sim` for the reason `combat.ts` and `round.ts` are: the rules are the part worth
 * asserting, and asserting them against a live Rapier world would mean playing a match to test
 * arithmetic. `Sim` owns one of these in **both** modes -- stroke play has a clock too -- and
 * delegates `matchTimeRemaining` and `matchOver` to it, so there is one countdown in the project
 * rather than two that can disagree.
 *
 * ## The two meanings of "stroke", which are not the same number
 *
 * `Cart.strokesTaken` counts **ball hits absorbed**, one per hit, and is the score of the
 * cart-combat mode that shipped 3 September. **Arena's stroke is a death**, counted here. They
 * differ by the height of the health bar: at `ARENA_MAX_HEALTH` a cart takes eight of the former
 * per one of the latter.
 *
 * Nothing in this file derives one from the other, and nothing should. A scoreboard that folded
 * them together would be wrong by a factor of the health bar and would look plausible at every
 * value it ever displayed.
 *
 * DOM-free, allocation-free after construction.
 */

export interface MatchOptions {
  /** Carts in the match, player included. Sizes nothing -- the arrays are always MAX_PLAYERS. */
  readonly playerCount: number;
  readonly durationS: number;
}

/** `winningTeam()` while the match is still running. Distinct from a draw, which is an answer. */
export const TEAM_PENDING = -2;
/** `winningTeam()` when the sides finished level. */
export const TEAM_DRAW = -1;

export class Match {
  /**
   * The roster being scored. Not readonly, and `setRoster` is why: `Sim` builds its `Match` in
   * its constructor, which runs before `create` has added a single bot, so the count arrives
   * afterwards.
   *
   * It bounds the loops and the scoreboard listing and nothing else. An index past it holds
   * zeroes either way, so a stale count can shorten what is *displayed* but cannot change a
   * total that is already correct.
   */
  playerCount: number;
  readonly durationS: number;
  /** Seconds left. Counts down every `tick` until it hits zero, then stops. */
  remaining: number;
  /** Set once, on the tick the clock reaches zero. */
  over: boolean;

  /**
   * Fixed length, allocated once, never resized -- `MAX_PLAYERS` is a Phase 5 target and this
   * build will not fill them. Typed arrays rather than `number[]` so the whole scoreboard is one
   * allocation each and a per-tick read costs nothing.
   *
   * Private with accessor methods rather than public fields, per the `AGENTS.md` rule that
   * nothing outside the sim mutates its state directly -- an exposed `Int32Array` is a writable
   * handle however it is typed.
   */
  private readonly points = new Int32Array(MAX_PLAYERS);
  private readonly strokes = new Int32Array(MAX_PLAYERS);

  constructor(options: MatchOptions) {
    this.playerCount = options.playerCount;
    this.durationS = options.durationS;
    this.remaining = options.durationS;
    this.over = false;
  }

  /** See `playerCount`. Called by `Sim` once its rigs exist, and by `loadCourse` on a mode swap. */
  setRoster(playerCount: number): void {
    this.playerCount = playerCount;
  }

  /** Kills scored by one player. Decides the MVP, and nothing else. */
  pointsFor(index: number): number {
    return this.points[index] ?? 0;
  }

  /** Deaths suffered by one player. Aggregated into the team score, which decides the match. */
  strokesFor(index: number): number {
    return this.strokes[index] ?? 0;
  }

  /**
   * Advance the clock one fixed step.
   *
   * Half a tick of slack, not `<= 0`. Repeated subtraction of 1/60 leaves a float residue -- a
   * five-tick match ends on 6.9e-18, not on 0 -- so an exact test never fires and the clock runs
   * a tick long, or forever. The threshold makes "the tick that brings it to zero" exact. Moved
   * here verbatim from `Sim.step`, comment included, because the reasoning is the value.
   */
  tick(dt: number): void {
    if (this.over) return;
    this.remaining -= dt;
    if (this.remaining <= dt * 0.5) {
      this.remaining = 0;
      this.over = true;
    }
  }

  /** Ends the match now, whatever the clock says. The buzzer, for a caller that already knows. */
  finish(): void {
    this.remaining = 0;
    this.over = true;
  }

  /**
   * One death.
   *
   * The stroke lands on the victim's team however the death happened -- a team kill and a
   * drowning both cost the side a life, and that is the punishment for both.
   *
   * The point lands only on an **enemy** killer. `NO_KILLER` is the unattributed death
   * (drowning, or anything with no other cart involved) and is guarded before the array is
   * indexed; a team kill is guarded by the side comparison. Neither is an error case, so
   * neither throws.
   */
  scoreKill(killer: number, victim: number): void {
    if (victim >= 0 && victim < MAX_PLAYERS) this.strokes[victim] += 1;
    if (killer === NO_KILLER || killer < 0 || killer >= MAX_PLAYERS) return;
    if (teamOf(killer) === teamOf(victim)) return;
    this.points[killer] += 1;
  }

  /** Deaths across one side. The number the match is decided on. */
  teamStrokes(team: number): number {
    let total = 0;
    for (let i = 0; i < this.playerCount; i++) {
      if (teamOf(i) === team) total += this.strokes[i]!;
    }
    return total;
  }

  /**
   * The side with the **fewest** strokes: the team wins by not dying.
   *
   * `TEAM_PENDING` while the clock is running and `TEAM_DRAW` when the sides finished level --
   * two distinct values, because "not finished" and "finished level" are different facts and a
   * caller that cannot tell them apart renders a draw over a live match.
   */
  winningTeam(): number {
    if (!this.over) return TEAM_PENDING;

    let best = TEAM_DRAW;
    let fewest = Number.POSITIVE_INFINITY;
    let tied = false;
    for (let team = 0; team < TEAM_COUNT; team++) {
      const strokes = this.teamStrokes(team);
      if (strokes < fewest) {
        fewest = strokes;
        best = team;
        tied = false;
      } else if (strokes === fewest) {
        tied = true;
      }
    }
    return tied ? TEAM_DRAW : best;
  }

  /**
   * Most kills. A tie breaks toward the **lower index**, stated rather than left to whatever the
   * loop happens to do -- a strict `>` scan is what makes that true, and `>=` would answer the
   * highest tied index instead.
   *
   * A match in which nobody scored returns player 0 rather than null: a scoreboard has to render
   * something, and a leader on zero is the honest answer. Callers show the points beside the
   * name, so a zero reads as a zero.
   */
  mvp(): number {
    let best = 0;
    let most = -1;
    for (let i = 0; i < this.playerCount; i++) {
      const points = this.points[i]!;
      if (points > most) {
        most = points;
        best = i;
      }
    }
    return best;
  }

  /** Clock back to full, scoreboard back to nothing. `Sim.reset`'s half of a "play again". */
  reset(): void {
    this.remaining = this.durationS;
    this.over = false;
    this.points.fill(0);
    this.strokes.fill(0);
  }
}
