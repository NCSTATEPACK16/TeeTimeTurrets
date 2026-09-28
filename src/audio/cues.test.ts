import { describe, expect, it } from "vitest";
import { ClubType } from "../physics/Ballistics";
import { NO_TARGET_RIG } from "../sim/events";
import type { SimEvent } from "../sim/events";
import { NO_KILLER } from "../sim/matchConfig";
import { HEARING_RANGE_M, createCueRequest, cueFor, engineTone, heartbeatPeriod, spatialize } from "./cues";

const LISTENER = { x: 0, z: 0, yaw: 0 };

function event(kind: SimEvent["kind"], actor: number, target: number, at = { x: 0, z: 0 }, club: ClubType | null = null): SimEvent {
  return { seq: 0, kind, actor, target, x: at.x, y: 1, z: at.z, amount: 1, club };
}

function cue(e: SimEvent) {
  const out = createCueRequest();
  return cueFor(e, LISTENER, out) ? { ...out } : null;
}

describe("cueFor", () => {
  it("gives each club its own report, full and centred when the player fires", () => {
    expect(cue(event("shot", 0, NO_TARGET_RIG, undefined, ClubType.Putter))).toEqual({ cue: "putter", gain: 1, pan: 0 });
    expect(cue(event("shot", 0, NO_TARGET_RIG, undefined, ClubType.Iron))!.cue).toBe("iron");
    expect(cue(event("shot", 0, NO_TARGET_RIG, undefined, ClubType.Driver))!.cue).toBe("driver");
  });

  it("places a bot's shot where it was fired, and drops one out of earshot", () => {
    const near = cue(event("shot", 3, NO_TARGET_RIG, { x: 0, z: 20 }, ClubType.Putter))!;
    expect(near.gain).toBeGreaterThan(0);
    expect(near.gain).toBeLessThan(1);
    expect(near.pan).toBeGreaterThan(0.9); // +Z is to the right looking down +X
    expect(cue(event("shot", 3, NO_TARGET_RIG, { x: HEARING_RANGE_M + 1, z: 0 }, ClubType.Putter))).toBeNull();
  });

  it("tells the player's own hit, a hit taken, a kill and a death apart", () => {
    expect(cue(event("hit", 0, 3))!.cue).toBe("hit");
    expect(cue(event("hit", 3, 0))!.cue).toBe("hurt");
    expect(cue(event("kill", 0, 3))!.cue).toBe("kill");
    expect(cue(event("kill", 3, 0))!.cue).toBe("died");
    expect(cue(event("kill", NO_KILLER, 0))!.cue).toBe("died");
  });

  it("keeps the player's own clicks, pickups and respawns to the player", () => {
    expect(cue(event("dryfire", 0, NO_TARGET_RIG))!.cue).toBe("dryfire");
    expect(cue(event("dryfire", 2, NO_TARGET_RIG))).toBeNull();
    expect(cue(event("pickup", 0, NO_TARGET_RIG))!.cue).toBe("pickup");
    expect(cue(event("pickup", 2, NO_TARGET_RIG))).toBeNull();
    expect(cue(event("respawn", NO_TARGET_RIG, 0))!.cue).toBe("respawn");
    expect(cue(event("respawn", NO_TARGET_RIG, 2))).toBeNull();
  });

  it("makes no sound for a stroke: the kill already did", () => {
    expect(cue(event("stroke", NO_TARGET_RIG, 0))).toBeNull();
  });
});

describe("spatialize", () => {
  it("is full and centred on the listener, and fades to nothing at the edge of hearing", () => {
    const out = { gain: 0, pan: 0 };
    spatialize(LISTENER, 0, 0, out);
    expect(out).toEqual({ gain: 1, pan: 0 });
    spatialize(LISTENER, HEARING_RANGE_M / 2, 0, out);
    expect(out.gain).toBeCloseTo(0.25, 9);
    spatialize(LISTENER, HEARING_RANGE_M, 0, out);
    expect(out.gain).toBe(0);
  });

  it("pans by bearing from where the player looks", () => {
    const out = { gain: 0, pan: 0 };
    spatialize(LISTENER, 0, -10, out);
    expect(out.pan).toBeCloseTo(-1, 9);
    spatialize({ x: 0, z: 0, yaw: Math.PI / 2 }, 0, 10, out);
    expect(out.pan).toBeCloseTo(0, 9);
  });
});

describe("engineTone", () => {
  it("idles low and quiet and rises with speed, forward or back", () => {
    const idle = engineTone(0);
    const half = engineTone(10);
    const flat = engineTone(20);
    expect(half.frequency).toBeGreaterThan(idle.frequency);
    expect(flat.frequency).toBeGreaterThan(half.frequency);
    expect(flat.gain).toBeGreaterThan(idle.gain);
    expect(engineTone(-10)).toEqual(half);
    expect(engineTone(80)).toEqual(flat);
  });
});

describe("heartbeatPeriod", () => {
  it("is silent without the vignette, and beats faster as it closes in", () => {
    expect(heartbeatPeriod(0)).toBe(0);
    expect(heartbeatPeriod(0.5)).toBeGreaterThan(heartbeatPeriod(1));
    expect(heartbeatPeriod(1)).toBeGreaterThan(0);
  });
});
