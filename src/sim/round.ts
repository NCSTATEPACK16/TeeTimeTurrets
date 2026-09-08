/**
 * A round: the list of holes, the card, and the stats that outlive any one hole.
 *
 * `Sim` owns the *current* hole and its `strokes`. This owns the sequence. `ARCHITECTURE.md`
 * keeps them apart on purpose and `ROADMAP.md` says why -- merging a round into `Sim` is what
 * makes multi-hole expensive later. So this file is DOM-free, Rapier-free and imports nothing
 * from the renderer, like everything else under `src/sim/**`.
 *
 * It absorbs `stats.ts`'s counters and adds the fourth tile image 13 asks for, `longestDrive`.
 * All four are the only input the Phase 3.5 economy has, which is why they are recorded from the
 * start even while a stroke-play round leaves three of them reading zero.
 */

import { accuracy, createStats, foldStats } from "./stats";
import type { Stats } from "./stats";

export type HoleResult = "under" | "level" | "over";

export interface HoleCard {
  readonly par: number;
  /** Null until the hole is played -- distinct from 0, which no hole can score. */
  readonly strokes: number | null;
  /** Null until played, so a scorecard cell has nothing to style rather than a false "level". */
  readonly result: HoleResult | null;
}

export class Round {
  private readonly pars: readonly number[];
  private readonly strokes: (number | null)[];
  private readonly counters: Stats;
  private index = 0;

  /**
   * The counters are **owned**, not borrowed.
   *
   * They used to be taken by reference so a round could wrap the very object `Sim.stats` hands to
   * `combat.ts`, which was right while a session was one hole long. It stops being right the
   * moment holes advance: a new `Sim` per hole means a new counters object, so the round had to be
   * rebuilt to re-point at it -- and rebuilding the round is what wiped the card and pinned the
   * player on hole 2. See `session.test.ts`.
   *
   * So the direction is reversed. `Sim.stats` counts one hole, and `completeHole` folds it in.
   */
  constructor(pars: readonly number[]) {
    if (pars.length === 0) throw new Error("a round needs at least one hole");
    this.pars = [...pars];
    this.strokes = pars.map(() => null);
    this.counters = createStats();
  }

  /** 0-based index of the hole being played. Equals the hole count once the round is complete. */
  get holeIndex(): number {
    return this.index;
  }

  get complete(): boolean {
    return this.index >= this.pars.length;
  }

  get card(): readonly HoleCard[] {
    return this.pars.map((par, i) => {
      const strokes = this.strokes[i] ?? null;
      return { par, strokes, result: strokes === null ? null : compare(strokes, par) };
    });
  }

  /** Course par: every hole, played or not. The scorecard's PAR row and TOTAL column. */
  get totalPar(): number {
    return this.pars.reduce((a, b) => a + b, 0);
  }

  /** Par for the holes played so far. What `relativeToPar` is measured against mid-round. */
  get parThrough(): number {
    return this.pars.slice(0, this.playedCount).reduce((a, b) => a + b, 0);
  }

  get totalStrokes(): number {
    return this.strokes.reduce<number>((sum, s) => sum + (s ?? 0), 0);
  }

  /** Signed score against par for the holes played. `+ 0` so level par is 0 and never -0. */
  get relativeToPar(): number {
    return this.totalStrokes - this.parThrough + 0;
  }

  get stats(): Readonly<Stats> {
    return this.counters;
  }

  /** 0 rather than NaN before the first shot -- a HUD would render "NaN%". */
  get accuracy(): number {
    return accuracy(this.counters);
  }

  /**
   * Score the current hole, fold in what happened on it, and move to the next.
   *
   * `holeStats` is the finished `Sim`'s counters. Passing them here rather than having the round
   * watch a live object is what makes the four tiles a *round* total while leaving each hole's own
   * numbers intact for pricing that hole -- see `wallet.ts`.
   */
  completeHole(strokes: number, holeStats: Readonly<Stats> = createStats()): void {
    if (this.complete) throw new Error("the round is complete; no hole left to score");
    if (!Number.isInteger(strokes) || strokes < 1) {
      throw new Error(`strokes must be a positive integer, got ${strokes}`);
    }
    this.strokes[this.index] = strokes;
    this.index++;
    foldStats(this.counters, holeStats);
  }

  private get playedCount(): number {
    return Math.min(this.index, this.pars.length);
  }
}

function compare(strokes: number, par: number): HoleResult {
  if (strokes < par) return "under";
  if (strokes > par) return "over";
  return "level";
}
