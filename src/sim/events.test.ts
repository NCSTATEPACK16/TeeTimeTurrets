import { describe, expect, it } from "vitest";
import { SimEventLog, NO_RIG } from "./events";

function pushHit(log: SimEventLog, tick: number, amount = 1): void {
  log.push("hit", tick, 0, 1, amount, 0, 0, 0);
}

describe("SimEventLog", () => {
  it("numbers events from zero and reads them back by sequence", () => {
    const log = new SimEventLog(8);
    pushHit(log, 5, 2);
    log.push("kill", 5, 0, 1, 0, 1, 2, 3);
    expect(log.total).toBe(2);
    expect(log.at(0)!.kind).toBe("hit");
    expect(log.at(0)!.amount).toBe(2);
    const kill = log.at(1)!;
    expect([kill.kind, kill.tick, kill.actor, kill.target, kill.x, kill.y, kill.z]).toEqual(["kill", 5, 0, 1, 1, 2, 3]);
    expect(log.at(2)).toBeNull(); // not written yet
  });

  it("overwrites the oldest once full, and says so instead of handing back a recycled slot", () => {
    const log = new SimEventLog(4);
    for (let t = 0; t < 6; t++) pushHit(log, t);
    expect(log.total).toBe(6);
    expect(log.oldest).toBe(2);
    expect(log.at(1)).toBeNull(); // overwritten: reading it would silently return tick 5's event
    expect(log.at(2)!.tick).toBe(2);
    expect(log.at(5)!.tick).toBe(5);
  });

  it("gives each reader every event exactly once, however many ticks ran between reads", () => {
    const log = new SimEventLog(16);
    const cursor = log.cursor();
    const seen: number[] = [];
    const read = (): void => {
      for (let s = cursor.begin(); s < log.total; s++) seen.push(log.at(s)!.tick);
      cursor.end();
    };
    pushHit(log, 1);
    pushHit(log, 2); // two ticks before the first frame reads
    read();
    read(); // a frame with no tick in between reads nothing
    pushHit(log, 3);
    read();
    expect(seen).toEqual([1, 2, 3]);
  });

  it("lets a reader that fell behind skip what was overwritten rather than replaying garbage", () => {
    const log = new SimEventLog(4);
    const cursor = log.cursor();
    for (let t = 0; t < 10; t++) pushHit(log, t);
    const seen: number[] = [];
    for (let s = cursor.begin(); s < log.total; s++) seen.push(log.at(s)!.tick);
    cursor.end();
    expect(seen).toEqual([6, 7, 8, 9]);
  });

  it("starts a new reader at the present, so it does not replay the match so far", () => {
    const log = new SimEventLog(8);
    pushHit(log, 1);
    const late = log.cursor();
    expect(late.begin()).toBe(log.total);
  });

  it("writes in place: pushing never allocates a new event object", () => {
    const log = new SimEventLog(2);
    pushHit(log, 0);
    const slot = log.at(0);
    pushHit(log, 1);
    pushHit(log, 2); // wraps onto slot 0
    expect(log.at(2)).toBe(slot);
    expect(NO_RIG).toBeLessThan(0);
  });
});
