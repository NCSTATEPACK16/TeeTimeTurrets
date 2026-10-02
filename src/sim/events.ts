/**
 * What happened in the match, for everything that reacts to it rather than simulates it: hit
 * markers, the kill feed, effects and audio.
 *
 * **Why a ring with sequence numbers, not a per-tick list.** The previous per-tick buffer was
 * cleared at the start of every step, but a renderer running slower than 60 Hz steps the sim
 * several times per frame, so every tick but the last lost its events before anything read them.
 * Here every event gets a sequence number that only grows (`total` is the next one). Each reader
 * holds its own `SimEventCursor` and reads from where it stopped, so a frame that follows three
 * ticks sees all three ticks' events, and two readers (the HUD and audio) each see every event
 * once without coordinating.
 *
 * **Why fixed slots written in place.** `push` runs inside `Sim.step`, where AGENTS.md forbids
 * allocation. The slots are made once and overwritten. A reader that falls more than `capacity`
 * events behind skips what was overwritten (`oldest`) instead of reading a recycled slot as if it
 * were the event it asked for.
 *
 * Output only: nothing in `src/sim/**` reads the log back, so it cannot move the golden
 * fingerprint.
 */

import type { ClubType } from "../physics/Ballistics";
import { NO_KILLER } from "./matchConfig";

/**
 * - `shot`: a ball left a muzzle. `actor` fired it; `club` is what it was fired with.
 * - `dry`: a trigger pull that put nothing in the air, either an empty magazine or a full pool.
 *   `actor` pulled it.
 * - `hit`: a fired ball hurt a cart. `actor` fired it, `target` was hit, `amount` is the damage.
 * - `ram`: a collision hurt a cart. `actor` is the other cart, `target` was hurt, `amount` is the
 *   damage.
 * - `kill`: a cart reached 0 HP. This **is** the stroke charged to `target`'s team. `actor` is the
 *   killer, or `NO_RIG` for a death nobody caused (drowning).
 * - `pickup`: `actor` collected ammo or a hot dog; `amount` is the rounds, or the HP for a hot dog.
 * - `shieldGained`: `actor` drank a drink; `amount` is the plates it now has.
 * - `plateBroken`: `target` lost a shield plate. `actor` hit or rammed it off, or is `NO_RIG` when
 *   it decayed by itself; `amount` is the plates left.
 * - `splash`: `actor`'s cart went into water.
 * - `respawn`: `actor` came back.
 */
export type SimEventKind =
  | "shot"
  | "dry"
  | "hit"
  | "ram"
  | "kill"
  | "pickup"
  | "shieldGained"
  | "plateBroken"
  | "splash"
  | "respawn";

/** A rig index that is no rig: the killer of a drowned cart, the target of an event without one. */
export const NO_RIG = NO_KILLER;

export interface SimEvent {
  kind: SimEventKind;
  /** The sim tick it happened on, counted from the start of the match. */
  tick: number;
  actor: number;
  target: number;
  amount: number;
  /** The club a `shot` was fired with; null for every other kind. */
  club: ClubType | null;
  /** Where it happened, in world metres. */
  x: number;
  y: number;
  z: number;
}

/** How many events a log keeps. At 8 carts a busy tick writes a handful, so this is seconds. */
export const SIM_EVENT_CAPACITY = 256;

export class SimEventLog {
  private readonly slots: SimEvent[];
  private written = 0;

  constructor(readonly capacity: number = SIM_EVENT_CAPACITY) {
    this.slots = Array.from({ length: capacity }, () => ({
      kind: "shot" as SimEventKind,
      tick: 0,
      actor: NO_RIG,
      target: NO_RIG,
      amount: 0,
      club: null as ClubType | null,
      x: 0,
      y: 0,
      z: 0,
    }));
  }

  /** The sequence number the next event will get, which is also how many have ever been written. */
  get total(): number {
    return this.written;
  }

  /** The oldest sequence number still readable. */
  get oldest(): number {
    return Math.max(0, this.written - this.capacity);
  }

  push(
    kind: SimEventKind,
    tick: number,
    actor: number,
    target: number,
    amount: number,
    x: number,
    y: number,
    z: number,
    club: ClubType | null = null,
  ): void {
    const e = this.slots[this.written % this.capacity]!;
    e.kind = kind;
    e.tick = tick;
    e.actor = actor;
    e.target = target;
    e.amount = amount;
    e.club = club;
    e.x = x;
    e.y = y;
    e.z = z;
    this.written++;
  }

  /** Event `seq`, or null if it has not happened yet or has been overwritten. */
  at(seq: number): SimEvent | null {
    if (seq < this.oldest || seq >= this.written) return null;
    return this.slots[seq % this.capacity]!;
  }

  /** A reader that starts at the present: it sees what happens from now on, not the past. */
  cursor(): SimEventCursor {
    return new SimEventCursor(this);
  }
}

/**
 * One reader's place in a log. Read with
 * `for (let s = c.begin(); s < log.total; s++) { const e = log.at(s)!; ... } c.end();`,
 * which allocates nothing.
 */
export class SimEventCursor {
  private next: number;

  constructor(private readonly log: SimEventLog) {
    this.next = log.total;
  }

  /** The first sequence number this reader has not seen and that is still readable. */
  begin(): number {
    return Math.max(this.next, this.log.oldest);
  }

  /** Marks everything written so far as read. */
  end(): void {
    this.next = this.log.total;
  }
}
