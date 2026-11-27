import { TEAM_COUNT, teamOf } from "./matchConfig";
import type { Match } from "./match";
import { NO_RIG } from "./events";
import type { SimEventLog } from "./events";

/**
 * Capture flags A, B and C (Stage 3.5c): three greens, each owned by a side or by nobody, and a
 * stroke bleed for the side that holds fewer of them.
 * `docs/superpowers/specs/2026-11-27-mortar-and-capture-flags-design.md` §2 is the rulebook.
 *
 * Split out of `Sim` for the reason `match.ts` is: the rules are the part worth asserting, and
 * asserting them should not need a Rapier world. DOM-free, Rapier-free, and allocation-free after
 * construction -- `tick` runs once per fixed tick.
 *
 * **Everything counts whole ticks, not seconds.** A capture is `CAPTURE_TICKS` of one cart's
 * presence; a bleed is `BLEED_TICKS` of holding two flags. Integers make "captured on the 360th
 * tick" exact. Summing `1/60` in floats would leave the residue that `Match.tick` needs half a
 * tick of slack to survive, and a capture that lands a tick late is a rule nobody wrote.
 */

/** From the cup, in x and z only: the green's 11 m and a metre more. */
export const CAPTURE_RADIUS_M = 12;
/** One cart alone takes a neutral flag in this long, and an enemy one in twice it (through neutral). */
export const CAPTURE_TIME_S = 6;
/** More carts capture faster, up to this many. */
export const CAPTURE_MAX_CARTS = 3;
/** A side holding two or more flags costs the other side one stroke this often. */
export const FLAG_BLEED_INTERVAL_S = 20;

/** The sim's fixed rate. `world.ts`'s `FIXED_DT` is 1/60; this module counts in its ticks. */
const TICKS_PER_S = 60;
/** Progress from neutral to owned, in cart-ticks. */
export const CAPTURE_TICKS = CAPTURE_TIME_S * TICKS_PER_S;
export const BLEED_TICKS = FLAG_BLEED_INTERVAL_S * TICKS_PER_S;

/** `owner` of a flag nobody holds. */
export const NO_TEAM = -1;

const RADIUS_SQ = CAPTURE_RADIUS_M * CAPTURE_RADIUS_M;

/** Where a flag stands. `y` is the ground at the cup, for the events' position. */
export interface CaptureSite {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** The slice of a cart the flags read. A cart's index in the list is its rig index. */
export interface CaptureCart {
  readonly position: { readonly x: number; readonly z: number };
  readonly dead: boolean;
}

export class CaptureField {
  readonly sites: readonly CaptureSite[];
  /** The side that owns each flag, or `NO_TEAM`. */
  readonly owner: Int8Array;
  /**
   * Each flag's capture, in cart-ticks: team 0 pushes it toward `-CAPTURE_TICKS`, team 1 toward
   * `+CAPTURE_TICKS`. Owned at either end; `progress(i)` gives it as -1..+1.
   */
  readonly points: Int32Array;
  /** 1 while both sides have a living cart on the flag. Nobody gains while it is. */
  readonly contested: Uint8Array;
  /** The side holding two or more flags, or `NO_TEAM`. */
  bleedHolder = NO_TEAM;
  /** Ticks until that side's next bleed stroke lands on the other side. */
  bleedTicks = BLEED_TICKS;

  /** Living carts of each team on the flag being counted. Reused every tick. */
  private readonly present = new Int32Array(TEAM_COUNT);

  constructor(sites: readonly CaptureSite[]) {
    this.sites = sites;
    this.owner = new Int8Array(sites.length).fill(NO_TEAM);
    this.points = new Int32Array(sites.length);
    this.contested = new Uint8Array(sites.length);
  }

  /** Flag `i`'s capture as -1 (team 0's) .. +1 (team 1's). */
  progress(i: number): number {
    return (this.points[i] ?? 0) / CAPTURE_TICKS;
  }

  /** Seconds until the next bleed stroke, while a side holds two. */
  get bleedInS(): number {
    return this.bleedTicks / TICKS_PER_S;
  }

  /** Flags `team` owns. */
  ownedBy(team: number): number {
    let n = 0;
    for (let i = 0; i < this.owner.length; i++) if (this.owner[i] === team) n++;
    return n;
  }

  /**
   * One fixed tick of flags: who is on each, who takes it, and the bleed. `Sim` calls it on live
   * ticks only, after the tick's contacts have killed whoever they killed, so a cart that died
   * this tick holds nothing.
   */
  tick(carts: readonly CaptureCart[], match: Match, events: SimEventLog, tickCount: number): void {
    for (let f = 0; f < this.sites.length; f++) this.tickFlag(f, carts, events, tickCount);
    this.tickBleed(match, events, tickCount);
  }

  private tickFlag(f: number, carts: readonly CaptureCart[], events: SimEventLog, tickCount: number): void {
    const site = this.sites[f]!;
    const present = this.present;
    present.fill(0);
    for (let i = 0; i < carts.length; i++) {
      const cart = carts[i]!;
      if (cart.dead) continue;
      const dx = cart.position.x - site.x;
      const dz = cart.position.z - site.z;
      if (dx * dx + dz * dz <= RADIUS_SQ) present[teamOf(i)]! += 1;
    }

    const zero = present[0]!;
    const one = present[1]!;
    this.contested[f] = zero > 0 && one > 0 ? 1 : 0;
    if (this.contested[f] === 1 || (zero === 0 && one === 0)) return;

    // One side alone. Team 0 pushes toward the negative end, team 1 toward the positive.
    const team = zero > 0 ? 0 : 1;
    const step = Math.min(zero + one, CAPTURE_MAX_CARTS) * (team === 0 ? -1 : 1);
    const before = this.points[f]!;
    const after = Math.max(-CAPTURE_TICKS, Math.min(CAPTURE_TICKS, before + step));
    this.points[f] = after;

    const owner = this.owner[f]!;
    // An enemy flag goes neutral the tick its capture crosses zero, before anyone else owns it.
    if (owner !== NO_TEAM && owner !== team && (team === 0 ? after <= 0 : after >= 0)) {
      this.owner[f] = NO_TEAM;
      events.push("flagNeutral", tickCount, NO_RIG, f, owner, site.x, site.y, site.z);
    }
    if (this.owner[f] !== team && Math.abs(after) === CAPTURE_TICKS) {
      this.owner[f] = team;
      events.push("flagCaptured", tickCount, NO_RIG, f, team, site.x, site.y, site.z);
    }
  }

  /**
   * Two or more flags make the other side bleed a stroke every `BLEED_TICKS`. A change of holder,
   * to a side or to nobody, restarts the interval in full, so the first stroke lands `BLEED_TICKS`
   * after the second flag is taken, and a holding that drops to one banks nothing.
   */
  private tickBleed(match: Match, events: SimEventLog, tickCount: number): void {
    let holder = NO_TEAM;
    for (let team = 0; team < TEAM_COUNT; team++) if (this.ownedBy(team) >= 2) holder = team;
    if (holder !== this.bleedHolder) {
      this.bleedHolder = holder;
      this.bleedTicks = BLEED_TICKS;
      return;
    }
    if (holder === NO_TEAM) return;
    this.bleedTicks -= 1;
    if (this.bleedTicks > 0) return;
    this.bleedTicks = BLEED_TICKS;
    const bled = holder === 0 ? 1 : 0;
    match.addBleed(bled);
    events.push("flagBleed", tickCount, NO_RIG, bled, match.bleedFor(bled), 0, 0, 0);
  }

  /** Every flag back to neutral and nobody bleeding: `Sim.reset`'s half of "play again". */
  reset(): void {
    this.owner.fill(NO_TEAM);
    this.points.fill(0);
    this.contested.fill(0);
    this.bleedHolder = NO_TEAM;
    this.bleedTicks = BLEED_TICKS;
  }
}
