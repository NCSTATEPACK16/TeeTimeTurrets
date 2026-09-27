import { describe, expect, it } from "vitest";
import { ClubType } from "../physics/Ballistics";
import type { SimEvent } from "../sim/events";
import { NO_TARGET_RIG } from "../sim/events";
import { SHAKE_MAX_OFFSET_M, TRAUMA_DECAY_PER_S, Trauma, traumaFor } from "./cameraShake";

describe("Trauma", () => {
  it("adds up to a ceiling of 1", () => {
    const t = new Trauma();
    t.add(0.6);
    t.add(0.6);
    expect(t.value).toBe(1);
  });

  it("decays linearly to zero and stops there", () => {
    const t = new Trauma();
    t.add(1);
    t.update(0.25);
    expect(t.value).toBeCloseTo(1 - 0.25 * TRAUMA_DECAY_PER_S, 9);
    t.update(10);
    expect(t.value).toBe(0);
  });

  it("shakes by the square of the trauma: nothing at none, a quarter of the most at half", () => {
    const out = { x: 0, y: 0, roll: 0 };
    const t = new Trauma();
    t.offset(1.234, out);
    expect(out).toEqual({ x: 0, y: 0, roll: 0 });

    // Sample many times and compare the largest displacement against the ceiling.
    let fullMax = 0;
    t.add(1);
    for (let i = 0; i < 400; i++) {
      t.offset(i * 0.013, out);
      fullMax = Math.max(fullMax, Math.abs(out.x), Math.abs(out.y));
    }
    expect(fullMax).toBeLessThanOrEqual(SHAKE_MAX_OFFSET_M + 1e-9);
    expect(fullMax).toBeGreaterThan(SHAKE_MAX_OFFSET_M * 0.8);

    const half = new Trauma();
    half.add(0.5);
    let halfMax = 0;
    for (let i = 0; i < 400; i++) {
      half.offset(i * 0.013, out);
      halfMax = Math.max(halfMax, Math.abs(out.x), Math.abs(out.y));
    }
    expect(halfMax / fullMax).toBeCloseTo(0.25, 6);
  });
});

function event(kind: SimEvent["kind"], actor: number, target: number, club: ClubType | null = null): SimEvent {
  return { seq: 0, kind, actor, target, x: 0, y: 0, z: 0, amount: 1, club };
}

describe("traumaFor", () => {
  it("kicks harder for the bigger club when the player fires, and not at all for a bot's shot", () => {
    const driver = traumaFor(event("shot", 0, NO_TARGET_RIG, ClubType.Driver));
    const iron = traumaFor(event("shot", 0, NO_TARGET_RIG, ClubType.Iron));
    const putter = traumaFor(event("shot", 0, NO_TARGET_RIG, ClubType.Putter));
    expect(driver).toBeGreaterThan(iron);
    expect(iron).toBeGreaterThan(putter);
    expect(traumaFor(event("shot", 3, NO_TARGET_RIG, ClubType.Driver))).toBe(0);
  });

  it("shakes for a hit taken, harder for being killed, and a little for a kill made", () => {
    const hurt = traumaFor(event("hit", 1, 0));
    const died = traumaFor(event("kill", 1, 0));
    const scored = traumaFor(event("kill", 0, 1));
    expect(hurt).toBeGreaterThan(0);
    expect(died).toBeGreaterThan(hurt);
    expect(scored).toBeGreaterThan(0);
    expect(traumaFor(event("hit", 1, 2))).toBe(0); // someone else's fight
  });
});
