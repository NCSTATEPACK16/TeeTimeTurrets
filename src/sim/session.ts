import { Round } from "./round";
import { earningsForHole } from "./wallet";
import { createStats } from "./stats";
import type { Stats } from "./stats";

/**
 * A play session: which hole comes next, the card so far, and the purse.
 *
 * This is the orchestration that used to live as three mutable locals in `main.ts` -- `round`,
 * `coins`, and the `startRound` closure that reassigned both. It moved here for one reason: the
 * bug it contained was invisible to every test in the suite, because `main.ts` is boot wiring
 * with no seam a node test can reach. `Sim` owns one hole, `Round` owns the sequence, and this
 * owns *advancing* -- the decision that sits above both and had nowhere to live.
 *
 * DOM-free and Rapier-free like everything under `src/sim/**`, so the progression can be played
 * out in the node suite without a browser or a physics world.
 */
export class Session {
  /** Built once and never replaced. Replacing it is precisely the bug this class was extracted
   *  to make visible: a fresh `Round` resets `holeIndex` to 0 and empties the card. */
  private readonly round: Round;
  private readonly pars: readonly number[];
  private coinBalance: number;
  /** The counters of the hole being played, handed over by `startHole`. */
  private holeStats: Stats = createStats();

  constructor(pars: readonly number[], startingCoins = 0) {
    this.pars = [...pars];
    this.round = new Round(this.pars);
    this.coinBalance = startingCoins;
  }

  /** The card the Results screen renders. */
  get card(): Round {
    return this.round;
  }

  get coins(): number {
    return this.coinBalance;
  }

  get complete(): boolean {
    return this.round.complete;
  }

  /**
   * The hole to load next, clamped to the last one so a finished round has something to render
   * rather than throwing at the caller.
   */
  get holeIndex(): number {
    return Math.min(this.round.holeIndex, this.pars.length - 1);
  }

  /**
   * Called as a hole is loaded, with the fresh `Sim`'s counters.
   *
   * The reference is held, not copied, so the numbers `combat.ts` writes during play are the ones
   * priced and folded in at the end of the hole. It is a *hole's* object, though: it is replaced
   * on the next call rather than accumulating, which is what makes per-hole pricing possible.
   */
  startHole(holeStats: Stats): void {
    this.holeStats = holeStats;
  }

  /**
   * Score the finished hole, pay for it, and fold its counters into the round. Returns the coins
   * earned, priced on this hole alone.
   */
  completeHole(strokes: number): number {
    const par = this.pars[this.round.holeIndex] ?? 0;
    const earned = earningsForHole(this.holeStats, strokes, par);
    this.round.completeHole(strokes, this.holeStats);
    this.coinBalance += earned;
    return earned;
  }

  spend(cost: number): void {
    this.coinBalance -= cost;
  }
}
