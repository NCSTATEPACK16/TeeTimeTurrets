import type { ClubType } from "../physics/Ballistics";

/**
 * What happened in the match, for everything that reacts to it rather than reads it: hit markers,
 * the kill feed, the damage flash, effects and audio. The sim writes; nothing it does depends on
 * what, if anything, reads.
 *
 * | kind      | actor                    | target        | position           | amount             | club |
 * |-----------|--------------------------|---------------|--------------------|--------------------|------|
 * | `shot`    | shooter                  | -             | muzzle             | charge, 0..1       | yes  |
 * | `dryfire` | the cart whose trigger went | -          | muzzle             | 0                  | yes  |
 * | `hit`     | shooter                  | victim        | ball at impact     | health taken       | -    |
 * | `kill`    | killer, or `NO_KILLER`   | victim        | victim             | 0                  | -    |
 * | `stroke`  | -                        | victim        | victim             | victim team's strokes now | - |
 * | `pickup`  | collector                | -             | collector          | rounds gained      | -    |
 * | `splash`  | -                        | cart          | where it went in   | 0                  | -    |
 * | `respawn` | -                        | cart          | spawn point        | 0                  | -    |
 *
 * `actor` and `target` are rig indices (0 is the player). "-" is `NO_TARGET_RIG`. A `hit` on the
 * player is the "hurt" a consumer wants; there is no separate kind for it.
 */
export type SimEventKind = "shot" | "dryfire" | "hit" | "kill" | "stroke" | "pickup" | "splash" | "respawn";

/** An actor or target slot that names no rig. Distinct from `NO_KILLER`, which is a killer. */
export const NO_TARGET_RIG = -1;

export interface SimEvent {
  /** Its number in the log: 0 for the first event of the Sim's life, then 1, 2, ... */
  seq: number;
  kind: SimEventKind;
  actor: number;
  target: number;
  x: number;
  y: number;
  z: number;
  amount: number;
  club: ClubType | null;
}

/** Events a `Sim` keeps. At a few dozen a second in a busy 4v4, over a second's worth. */
export const SIM_EVENT_CAPACITY = 256;

/**
 * A fixed ring of event records, numbered for ever upward.
 *
 * Each consumer keeps its own cursor -- the `seq` it will read next -- and reads forward to `head`.
 * That is what lets a hit marker spawn once whether the renderer draws one frame per tick or five,
 * and lets two consumers read the same event without either consuming it for the other. One that
 * falls a whole ring behind loses the oldest events, never reads a wrong one: `firstUnread` skips
 * it forward. `Sim.reset` does not clear it, so a cursor stays valid across a rematch.
 *
 * The records are preallocated and rewritten in place, so a push allocates nothing in the tick.
 * A consumer copies what it keeps and never holds a record.
 */
export class SimEventLog {
  readonly capacity: number;
  private readonly ring: SimEvent[];
  private written = 0;

  constructor(capacity: number = SIM_EVENT_CAPACITY) {
    this.capacity = capacity;
    this.ring = [];
    for (let i = 0; i < capacity; i++) {
      this.ring.push({ seq: -1, kind: "shot", actor: NO_TARGET_RIG, target: NO_TARGET_RIG, x: 0, y: 0, z: 0, amount: 0, club: null });
    }
  }

  /** The `seq` the next event will get: one past the newest. */
  get head(): number {
    return this.written;
  }

  /** The oldest `seq` still held. */
  get oldest(): number {
    return Math.max(0, this.written - this.capacity);
  }

  /** The event numbered `seq`, or null if it has not happened yet or has been overwritten. */
  at(seq: number): SimEvent | null {
    if (seq < this.oldest || seq >= this.written) return null;
    return this.ring[seq % this.capacity]!;
  }

  /** Where a consumer whose cursor is `cursor` should start reading. */
  firstUnread(cursor: number): number {
    return Math.min(this.written, Math.max(cursor, this.oldest));
  }

  push(
    kind: SimEventKind,
    actor: number,
    target: number,
    x: number,
    y: number,
    z: number,
    amount: number,
    club: ClubType | null,
  ): void {
    const e = this.ring[this.written % this.capacity]!;
    e.seq = this.written;
    e.kind = kind;
    e.actor = actor;
    e.target = target;
    e.x = x;
    e.y = y;
    e.z = z;
    e.amount = amount;
    e.club = club;
    this.written++;
  }
}
