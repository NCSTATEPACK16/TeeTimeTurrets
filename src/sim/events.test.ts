import { describe, expect, it } from "vitest";
import { ClubType } from "../physics/Ballistics";
import { NO_TARGET_RIG, SimEventLog } from "./events";

describe("SimEventLog", () => {
  it("numbers events from zero and hands each back by its number", () => {
    const log = new SimEventLog(8);
    expect(log.head).toBe(0);
    log.push("shot", 2, NO_TARGET_RIG, 1, 2, 3, 0.5, ClubType.Putter);
    log.push("hit", 2, 5, 4, 5, 6, 1, null);
    expect(log.head).toBe(2);

    const shot = log.at(0)!;
    expect(shot).toMatchObject({ seq: 0, kind: "shot", actor: 2, target: NO_TARGET_RIG, x: 1, y: 2, z: 3 });
    expect(shot.amount).toBe(0.5);
    expect(shot.club).toBe(ClubType.Putter);
    expect(log.at(1)).toMatchObject({ seq: 1, kind: "hit", actor: 2, target: 5, amount: 1, club: null });
  });

  it("keeps the newest events once it wraps, and says the oldest are gone", () => {
    const log = new SimEventLog(4);
    for (let i = 0; i < 6; i++) log.push("pickup", i, NO_TARGET_RIG, 0, 0, 0, i, null);
    expect(log.head).toBe(6);
    expect(log.oldest).toBe(2);
    expect(log.at(1)).toBeNull();
    expect(log.at(2)!.actor).toBe(2);
    expect(log.at(5)!.actor).toBe(5);
    expect(log.at(6)).toBeNull(); // not written yet
  });

  it("reuses its records rather than allocating one per event", () => {
    const log = new SimEventLog(2);
    log.push("kill", 1, 2, 0, 0, 0, 0, null);
    const first = log.at(0);
    log.push("kill", 1, 2, 0, 0, 0, 0, null);
    log.push("respawn", NO_TARGET_RIG, 2, 0, 0, 0, 0, null);
    // Same slot, rewritten in place: a consumer must copy what it keeps, never hold the record.
    expect(log.at(2)).toBe(first);
    expect(first!.kind).toBe("respawn");
  });

  it("clamps a stale cursor to the oldest event still held", () => {
    const log = new SimEventLog(4);
    for (let i = 0; i < 10; i++) log.push("shot", 0, NO_TARGET_RIG, 0, 0, 0, 1, ClubType.Putter);
    // A consumer that last read at 3 has missed events 4 and 5 for good; it resumes at 6.
    expect(log.firstUnread(3)).toBe(6);
    expect(log.firstUnread(8)).toBe(8);
    expect(log.firstUnread(10)).toBe(10);
  });
});
