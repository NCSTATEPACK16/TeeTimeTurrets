import { describe, expect, it } from "vitest";
import { ClubType } from "../physics/Ballistics";
import type { SimEvent } from "../sim/events";
import { NO_RIG } from "../sim/events";
import { HEARING_RANGE_M, cueFor, heartbeatInterval } from "./audioDirector";

function ev(partial: Partial<SimEvent>): SimEvent {
  return { kind: "shot", tick: 0, actor: 0, target: NO_RIG, amount: 0, club: null, x: 0, y: 0, z: 0, ...partial };
}

const listener = { x: 0, z: 0, yaw: 0 };

describe("cueFor", () => {
  it("gives each of the player's clubs its own sound, at full volume", () => {
    expect(cueFor(ev({ club: ClubType.Putter }), listener)).toMatchObject({ cue: "pop", gain: 1 });
    expect(cueFor(ev({ club: ClubType.Iron }), listener)).toMatchObject({ cue: "clack", gain: 1 });
    expect(cueFor(ev({ club: ClubType.Driver }), listener)).toMatchObject({ cue: "thwack", gain: 1 });
  });

  it("plays another cart's shot quieter with distance, and not at all out of earshot", () => {
    const near = cueFor(ev({ actor: 3, club: ClubType.Putter, x: 10 }), listener)!;
    const far = cueFor(ev({ actor: 3, club: ClubType.Putter, x: 50 }), listener)!;
    expect(near.cue).toBe("pop");
    expect(near.gain).toBeLessThan(1);
    expect(far.gain).toBeLessThan(near.gain);
    expect(cueFor(ev({ actor: 3, club: ClubType.Putter, x: HEARING_RANGE_M + 1 }), listener)).toBeNull();
  });

  it("pans a sound to the side it came from, as the camera faces", () => {
    // Facing +x, the camera's right is +z (see hitFeedback.damageScreenAngle).
    expect(cueFor(ev({ actor: 3, club: ClubType.Putter, z: 10 }), listener)!.pan).toBeGreaterThan(0.5);
    expect(cueFor(ev({ actor: 3, club: ClubType.Putter, z: -10 }), listener)!.pan).toBeLessThan(-0.5);
    expect(cueFor(ev({ club: ClubType.Putter }), listener)!.pan).toBe(0);
  });

  it("confirms the player's hits and kills, and marks the player being hurt", () => {
    expect(cueFor(ev({ kind: "hit", actor: 0, target: 3, amount: 1 }), listener)!.cue).toBe("hit");
    expect(cueFor(ev({ kind: "ram", actor: 0, target: 3, amount: 1 }), listener)!.cue).toBe("hit");
    expect(cueFor(ev({ kind: "kill", actor: 0, target: 3 }), listener)!.cue).toBe("kill");
    expect(cueFor(ev({ kind: "hit", actor: 3, target: 0, amount: 1 }), listener)!.cue).toBe("hurt");
    expect(cueFor(ev({ kind: "ram", actor: 3, target: 0, amount: 1 }), listener)!.cue).toBe("hurt");
  });

  it("plays other carts' deaths as a blast by distance, and the player's own as a death", () => {
    expect(cueFor(ev({ kind: "kill", actor: 1, target: 0 }), listener)!.cue).toBe("death");
    const blast = cueFor(ev({ kind: "kill", actor: 1, target: 2, x: 20 }), listener)!;
    expect(blast.cue).toBe("blast");
    expect(blast.gain).toBeLessThan(1);
  });

  it("plays the player's pickups and dry trigger pulls, and nobody else's", () => {
    expect(cueFor(ev({ kind: "pickup", actor: 0, amount: 30 }), listener)!.cue).toBe("pickup");
    expect(cueFor(ev({ kind: "dry", actor: 0 }), listener)!.cue).toBe("dry");
    expect(cueFor(ev({ kind: "pickup", actor: 2 }), listener)).toBeNull();
    expect(cueFor(ev({ kind: "dry", actor: 2 }), listener)).toBeNull();
  });

  it("splashes by distance, and says nothing for a respawn", () => {
    expect(cueFor(ev({ kind: "splash", actor: 2, x: 5 }), listener)!.cue).toBe("splash");
    expect(cueFor(ev({ kind: "respawn", actor: 0 }), listener)).toBeNull();
  });
});

describe("heartbeatInterval", () => {
  it("is silent when not low, and quickens as health falls", () => {
    expect(heartbeatInterval(0)).toBe(Infinity);
    const weak = heartbeatInterval(0.25);
    const strong = heartbeatInterval(1);
    expect(weak).toBeLessThan(Infinity);
    expect(strong).toBeLessThan(weak);
  });
});
