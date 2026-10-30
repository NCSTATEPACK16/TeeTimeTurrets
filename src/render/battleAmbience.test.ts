import { describe, expect, it } from "vitest";
import { mulberry32 } from "../sim/rng";
import { BattleAmbience } from "./battleAmbience";
import type { EffectsLayer } from "./effects";

describe("battle ambience", () => {
  it("flashes a distant blast first and delivers its boom later, at the speed of sound", () => {
    const blasts: { x: number; z: number; t: number }[] = [];
    let clock = 0;
    const effects = {
      distantBlast: (x: number, _y: number, z: number) => blasts.push({ x, z, t: clock }),
      flare: () => {},
    } as unknown as EffectsLayer;
    const battle = new BattleAmbience(effects, () => 0, mulberry32(11), null);
    const booms: number[] = [];
    battle.onBoom = () => booms.push(clock);
    const dt = 1 / 60;
    while (booms.length === 0 && clock < 30) {
      clock += dt;
      battle.update(dt, 0, 0, 0);
    }
    expect(blasts.length).toBeGreaterThan(0);
    const first = blasts[0]!;
    const d = Math.hypot(first.x, first.z);
    expect(d).toBeGreaterThan(150); // never on top of the fight
    expect(booms[0]! - first.t).toBeCloseTo(d / 343, 1);
  });
});
